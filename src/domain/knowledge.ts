import type { Database } from '../db.js'
import { isVersionApplicable } from '../version.js'
import type {
  PublicKnowledge,
  ResolvedNetworkContext
} from './schemas.js'
import type { InternalResolvedContext } from './context.js'

type KnowledgeRow = {
  revision_id: string
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

function toPublicKnowledge(
  row: KnowledgeRow,
  context: ResolvedNetworkContext,
  conflicts: ConflictRow[],
): PublicKnowledge {
  return {
    revision_ref: row.revision_id,
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
  kind?: PublicKnowledge['kind'],
): Promise<PublicKnowledge[]> {
  const normalizedQuestion = question
    .replace(/<[^>]{1,80}>/g, ' ')
    .replace(/[<>{}[\]|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const result = await database.query<KnowledgeRow>(
    `SELECT
       pak.*,
       (
         ts_rank_cd(pak.search_document, websearch_to_tsquery('simple', $1), 32)
         + similarity(lower(pak.title), lower($1)) * 0.15
         + pak.confidence::float8 * 0.10
         + pak.quality_score::float8 * 0.10
         + CASE WHEN pak.platform_slug IS NOT NULL AND pak.platform_slug = $4 THEN 0.15 ELSE 0 END
       )::float8 AS rank
     FROM public_active_knowledge pak
     WHERE pak.vendor_slug = $2
       AND pak.operating_system_slug = $3
       AND ($4::text IS NULL OR pak.platform_slug IS NULL OR pak.platform_slug = $4)
       AND ($5::text IS NULL OR pak.kind = $5)
       AND (
         pak.search_document @@ websearch_to_tsquery('simple', $1)
         OR similarity(lower(pak.title), lower($1)) >= 0.32
         OR similarity(lower(pak.summary), lower($1)) >= 0.28
       )
     ORDER BY rank DESC, pak.confidence DESC, pak.last_verified_at DESC
     LIMIT 25`,
    [
      normalizedQuestion,
      context.vendor_slug,
      context.operating_system_slug,
      context.platform_slug,
      kind ?? null
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
    `SELECT pak.*, 1::float8 AS rank
     FROM public_active_knowledge pak
     WHERE pak.revision_id = $1`,
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
