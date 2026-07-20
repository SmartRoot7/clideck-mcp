import type { Database } from '../db.js'
import { isVersionApplicable } from '../version.js'
import type {
  PublicKnowledge,
  ResolvedNetworkContext
} from './schemas.js'
import type { InternalResolvedContext } from './context.js'
import { buildSearchQueries } from './search-query.js'

type KnowledgeRow = {
  revision_id: string
  public_ref: string
  kind: PublicKnowledge['kind']
  vendor_name: string
  platform_name: string | null
  operating_system_name: string
  version_min: string | null
  version_max: string | null
  version_normalized_min: number[] | null
  version_normalized_max: number[] | null
  title: string
  summary: string
  cli_mode: string | null
  command_text: string | null
  procedure_steps: string[]
  prerequisites: string[]
  risks: string[]
  verification_steps: string[]
  rollback_steps: string[]
  limitations: string[]
  dangerous: boolean
  confidence: string
  quality_score: string
  last_verified_at: string | Date
  validation_level:
    | 'legacy_migrated'
    | 'documentation_reviewed'
    | 'batfish_modeled'
    | 'runtime_lab_validated'
  independent_confirmations: number
  confidence_explanation: string
  next_review_at: string | Date
  lab_validated_at: string | Date | null
  rank: number
}

type ConflictRow = {
  revision_id: string
  severity: 'informational' | 'warning' | 'blocking'
  description: string
}

function normalizedTerms(value: string | null | undefined): Set<string> {
  return new Set(value?.toLowerCase().match(/[a-z0-9]+/g) ?? [])
}

function semanticSearchTerms(
  tokens: readonly string[],
  context: InternalResolvedContext,
): string[] {
  // Vendor, OS and resolved platform are hard applicability filters. They
  // must not by themselves make an unrelated command look relevant.
  const contextTerms = new Set([
    ...normalizedTerms(context.vendor),
    ...normalizedTerms(context.vendor_slug),
    ...normalizedTerms(context.model),
    ...normalizedTerms(context.platform_slug),
    ...normalizedTerms(context.operating_system),
    ...normalizedTerms(context.operating_system_slug),
    ...normalizedTerms(context.version)
  ])
  return tokens.filter((token) => !contextTerms.has(token))
}

function toPublicKnowledge(
  row: KnowledgeRow,
  context: ResolvedNetworkContext,
  conflicts: ConflictRow[],
): PublicKnowledge {
  return {
    revision_ref: row.public_ref,
    kind: row.kind,
    title: row.title,
    summary: row.summary,
    applicability: {
      vendor: row.vendor_name,
      model: row.platform_name,
      operating_system: row.operating_system_name,
      versions: {
        minimum: row.version_min,
        maximum: row.version_max,
        requested: context.version
      }
    },
    cli_mode: row.cli_mode,
    command: row.command_text,
    procedure: row.procedure_steps,
    prerequisites: row.prerequisites,
    risks: row.risks,
    verification: row.verification_steps,
    rollback: row.rollback_steps,
    last_verified_at: new Date(row.last_verified_at).toISOString().slice(0, 10),
    confidence: Number(row.confidence),
    quality_score: Number(row.quality_score),
    dangerous: row.dangerous,
    assurance: {
      validation_level: row.validation_level,
      independent_confirmations: Number(row.independent_confirmations),
      confidence_explanation: row.confidence_explanation,
      next_review_at: new Date(row.next_review_at).toISOString().slice(0, 10),
      lab_validated_at: row.lab_validated_at
        ? new Date(row.lab_validated_at).toISOString()
        : null
    },
    conflicts: conflicts
      .filter((conflict) => conflict.revision_id === row.revision_id)
      .map(({ severity, description }) => ({ severity, description })),
    limitations: row.limitations
  }
}

export async function searchKnowledge(
  database: Database,
  question: string,
  context: InternalResolvedContext,
  limit: number,
  kind?: PublicKnowledge['kind'] | PublicKnowledge['kind'][],
): Promise<PublicKnowledge[]> {
  const searchQuestion =
    /\berrors?\b/i.test(question) &&
    /\b(?:ports?|interfaces?)\b/i.test(question)
      ? question.replace(/\berrors?\b/i, 'display interface counters errors')
      : question
  const search = buildSearchQueries(searchQuestion, {
    '9300': '',
    c9300: '',
    errors: 'error',
    interfaces: 'interface',
    port: 'interface',
    ports: 'interface'
  })
  const semanticTerms = semanticSearchTerms(search.tokens, context)
  // A one-word command lookup such as "reload" has one informative term;
  // broader questions need two independent subject terms. This eliminates
  // false positives where only the vendor or a generic word matched.
  const minimumSemanticMatches = Math.min(2, semanticTerms.length)
  if (minimumSemanticMatches === 0) return []
  const result = await database.query<KnowledgeRow>(
    `WITH ranked_revisions AS MATERIALIZED (
       SELECT
         kr.id AS revision_id,
         active.knowledge_item_id,
         (
           ts_rank_cd(
             kr.search_document,
             to_tsquery('simple', $6),
             32
           ) * 0.70
           + ts_rank_cd(
               kr.search_document,
               to_tsquery('simple', $7),
               32
             ) * 0.30
           + similarity(lower(kr.title), lower($1)) * 0.15
           + kr.confidence::float8 * 0.10
           + kr.quality_score::float8 * 0.10
           + CASE
               WHEN kr.platform_id IS NOT NULL AND kr.platform_id = $4
                 THEN 0.15
               ELSE 0
             END
         )::float8 AS rank,
         (
           SELECT count(*)::integer
           FROM unnest($8::text[]) AS semantic_term
           WHERE kr.search_document @@ to_tsquery(
             'simple',
             semantic_term || ':*'
           )
         ) AS semantic_matches
       FROM knowledge_revisions kr
       JOIN active_knowledge_state active ON active.revision_id = kr.id
       JOIN knowledge_items ki ON ki.id = active.knowledge_item_id
       WHERE ki.domain_id = 'network'
         AND kr.domain_id = 'network'
         AND kr.vendor_id = $2
         AND (
           kr.operating_system_id IS NULL
           OR kr.operating_system_id = $3
         )
         AND (
           $4::uuid IS NULL
           OR kr.platform_id IS NULL
           OR kr.platform_id = $4
         )
         AND ($5::text[] IS NULL OR ki.kind = ANY($5))
         AND (
           kr.search_document @@ to_tsquery('simple', $6)
           OR kr.search_document @@ to_tsquery('simple', $7)
           OR (
             lower(kr.title) % lower($1)
             AND similarity(lower(kr.title), lower($1)) >= 0.32
           )
         )
       ORDER BY rank DESC, kr.confidence DESC, kr.last_verified_at DESC
       LIMIT 25
     )
     SELECT
       rr.revision_id,
       kr.public_ref,
       ki.kind,
       v.display_name AS vendor_name,
       p.display_name AS platform_name,
       coalesce(os.display_name, 'Not specified') AS operating_system_name,
       kr.version_min,
       kr.version_max,
       kr.version_normalized_min,
       kr.version_normalized_max,
       kr.title,
       kr.summary,
       kr.cli_mode,
       kr.command_text,
       kr.procedure_steps,
       kr.prerequisites,
       kr.risks,
       kr.verification_steps,
       kr.rollback_steps,
       kr.limitations,
       kr.dangerous,
       kr.confidence,
       kr.quality_score,
       kr.last_verified_at,
       coalesce(
         current_validation.validation_level,
         CASE
           WHEN kpt.validation_level IN (
             'batfish_modeled',
             'runtime_lab_validated'
           )
             THEN 'documentation_reviewed'
           ELSE kpt.validation_level
         END,
         'documentation_reviewed'
       ) AS validation_level,
       coalesce(kpt.independent_confirmations, 1) AS independent_confirmations,
       coalesce(
         kpt.confidence_explanation,
         'Verified structured knowledge with bounded applicability.'
       ) AS confidence_explanation,
       coalesce(
         kpt.next_review_at,
         kr.last_verified_at + 180
       ) AS next_review_at,
       current_validation.lab_validated_at,
       rr.rank
     FROM ranked_revisions rr
     JOIN knowledge_revisions kr ON kr.id = rr.revision_id
     JOIN knowledge_items ki ON ki.id = rr.knowledge_item_id
     JOIN vendors v ON v.id = kr.vendor_id
     LEFT JOIN platforms p ON p.id = kr.platform_id
     LEFT JOIN operating_systems os ON os.id = kr.operating_system_id
     LEFT JOIN knowledge_public_trust kpt ON kpt.revision_id = kr.id
     LEFT JOIN LATERAL current_knowledge_validation(kr.id)
       current_validation ON true
     WHERE rr.rank >= greatest(
       coalesce((SELECT max(rank) * 0.5 FROM ranked_revisions), 0),
       0.01
     )
       AND rr.semantic_matches >= $9
     ORDER BY rr.rank DESC, kr.confidence DESC, kr.last_verified_at DESC`,
    [
      search.normalizedQuestion,
      context.vendorId,
      context.operatingSystemId,
      context.platformId,
      kind
        ? Array.isArray(kind) ? kind : [kind]
        : null,
      search.strictTsQuery,
      search.relaxedTsQuery,
      semanticTerms,
      minimumSemanticMatches
    ],
  )

  const applicableRows = result.rows
    .filter((row) =>
      isVersionApplicable(
        context.version ?? undefined,
        row.version_normalized_min,
        row.version_normalized_max,
      ),
    )
    .slice(0, limit)

  if (applicableRows.length === 0) return []

  const revisionIds = applicableRows.map((row) => row.revision_id)
  const conflicts = await database.query<ConflictRow>(
    `SELECT
       CASE
         WHEN kc.left_revision_id = ANY($1::uuid[]) THEN kc.left_revision_id
         ELSE kc.right_revision_id
       END AS revision_id,
       kc.severity,
       kc.description
     FROM knowledge_conflicts kc
     WHERE kc.status = 'open'
       AND (
         kc.left_revision_id = ANY($1::uuid[])
         OR kc.right_revision_id = ANY($1::uuid[])
       )
     ORDER BY
       CASE kc.severity
         WHEN 'blocking' THEN 1
         WHEN 'warning' THEN 2
         ELSE 3
       END`,
    [revisionIds],
  )

  return applicableRows.map((row) =>
    toPublicKnowledge(row, context, conflicts.rows),
  )
}

export async function getPublicRevision(
  database: Database,
  revisionId: string,
  requestedVersion: string | null = null,
): Promise<PublicKnowledge | null> {
  const result = await database.query<KnowledgeRow>(
    `SELECT pak.*, kr.public_ref, 1::float8 AS rank
     FROM public_active_knowledge pak
     JOIN knowledge_revisions kr ON kr.id = pak.revision_id
     WHERE pak.revision_id = $1 OR kr.public_ref = $1`,
    [revisionId],
  )
  const row = result.rows[0]
  if (!row) return null

  return toPublicKnowledge(
    row,
    {
      vendor: row.vendor_name,
      vendor_slug: '',
      model: row.platform_name,
      platform_slug: null,
      operating_system: row.operating_system_name,
      operating_system_slug: '',
      version: requestedVersion,
      applicable_version: requestedVersion ?? 'Version not supplied',
      resolution_confidence: 1,
      ambiguities: []
    },
    [],
  )
}
