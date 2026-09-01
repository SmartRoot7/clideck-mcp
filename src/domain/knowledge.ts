import type { Database } from '../db.js'
import type {
  PublicKnowledge,
  ResolvedNetworkContext
} from './schemas.js'
import type { InternalResolvedContext } from './context.js'
import { buildSearchQueries } from './search-query.js'
import {
  compareNormalizedVersions,
  normalizeVendorVersion
} from '../version.js'
import {
  assuranceFor,
  matchVersionApplicability,
  publicMatchLevel,
  type ApplicabilityScope,
  type PublicVersionMatch,
  type SoftwareVersionStrategy,
  type VersionScope
} from './applicability.js'
import { classifyKnowledgeRisk } from './risk.js'

type KnowledgeRow = {
  revision_id: string
  public_ref: string
  kind: PublicKnowledge['kind']
  revision_vendor_id: string | null
  revision_platform_id: string | null
  software_family_id: string | null
  portability_mode: 'portable' | 'vendor_specific' | null
  applicability_architecture_slug: string | null
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
  scope_level: ApplicabilityScope
  version_scope: VersionScope
  version_branch: string | null
  version_strategy: SoftwareVersionStrategy
  requires_platform_confirmation: boolean
  portable_semantic_key: Buffer
}

type ConflictRow = {
  revision_id: string
  severity: 'informational' | 'warning' | 'blocking'
  description: string
}

const nonSemanticSearchTerms = new Set([
  'add', 'change', 'configure', 'configuration', 'create', 'delete',
  'disable', 'enable', 'manage', 'remove', 'running', 'set', 'setup', 'show'
])

const relevanceStopWords = new Set([
  'a', 'an', 'and', 'do', 'for', 'how', 'i', 'in', 'is', 'it', 'of', 'on',
  'the', 'to', 'what', 'with'
])

const genericRelevanceTerms = new Set([
  'access', 'config', 'current', 'file', 'saved', 'show', 'startup'
])

function normalizedRelevanceToken(token: string): string {
  if (/^config(?:ure|ured|ures|uring|uration|urations)?$/.test(token)) {
    return 'config'
  }
  if (/^(?:delete|erase|remove|reset|wipe)$/.test(token)) return 'erase'
  if (/^(?:display|inspect|list|read|show|view)$/.test(token)) return 'show'
  if (/^files?$/.test(token)) return 'file'
  return token
}

function relevanceTokens(value: string): Set<string> {
  return new Set(
    (value.toLowerCase().match(/[a-z0-9]+/g) ?? [])
      .filter((token) => !relevanceStopWords.has(token))
      .map(normalizedRelevanceToken),
  )
}

type RelevanceEvidence = Pick<
  KnowledgeRow,
  'title' | 'summary' | 'command_text' | 'procedure_steps'
>

type ContextRelation = NonNullable<
  PublicKnowledge['applicability']['context_relation']
>

type DocumentedVersionRelation = NonNullable<
  PublicKnowledge['applicability']['documented_version_relation']
>

type CapabilityMatcher = (evidence: RelevanceEvidence) => boolean

/**
 * Database rank remains the candidate generator.  This small lexical pass
 * only orders those candidates by the operation the user actually asked for,
 * so an exact-context but unrelated "show" command does not outrank the
 * requested SSH/configuration/file operation.
 */
export function questionRelevanceScore(
  question: string,
  evidence: RelevanceEvidence,
): number {
  const requested = relevanceTokens(question)
  if (requested.size === 0) return 0
  const primary = relevanceTokens([
    evidence.title,
    evidence.command_text ?? ''
  ].join(' '))
  const supporting = relevanceTokens([
    evidence.summary,
    ...evidence.procedure_steps
  ].join(' '))
  let score = 0
  for (const token of requested) {
    const distinctive = !genericRelevanceTerms.has(token)
    if (primary.has(token)) score += distinctive ? 6 : 4
    else if (supporting.has(token)) score += distinctive ? 2 : 1
  }
  return score
}

/**
 * Candidate retrieval is deliberately broad. This is the single absolute
 * relevance floor: a one-term request needs that term, while a longer request
 * needs two content terms. Context words are removed before this function is
 * called, so a vendor, model, or version cannot make an unrelated answer pass.
 */
export function hasMinimumSemanticRelevance(
  semanticTerms: readonly string[],
  evidence: RelevanceEvidence,
): boolean {
  const requested = new Set(
    semanticTerms.map((term) => normalizedRelevanceToken(term.toLowerCase())),
  )
  if (requested.size === 0) return false
  const available = relevanceTokens([
    evidence.title,
    evidence.summary,
    evidence.command_text ?? '',
    ...evidence.procedure_steps
  ].join(' '))
  let matches = 0
  for (const term of requested) {
    if (available.has(term)) matches += 1
  }
  return matches >= (requested.size === 1 ? 1 : 2)
}

const operationalIntentPattern =
  /\b(?:add|apply|back\s+up|backup|change|configure|delete|disable|downgrade|enable|erase|migrate|recover|remove|replace|reset|restore|upgrade)\b/i

const readOnlyDiagnosticCommandPattern =
  /^(?:dir|display|more|ping|show|traceroute|tracert|verify)\b/i

export function isDeterministicallyReadOnlyPublicCommand(
  kind: PublicKnowledge['kind'],
  command: string | null,
): boolean {
  return (kind === 'command' || kind === 'diagnostic') &&
    Boolean(command) &&
    classifyKnowledgeRisk([command!]) === 'safe_read_only'
}

function hasExecutableAction(answer: PublicKnowledge): boolean {
  if (answer.procedure.length > 0) return true
  const commands = answer.command
    ?.split(/[;\n]+/)
    .map((command) => command.trim())
    .filter(Boolean) ?? []
  return commands.some(
    (command) => !readOnlyDiagnosticCommandPattern.test(command),
  )
}

export function filterActionableKnowledge(
  question: string,
  answers: readonly PublicKnowledge[],
  options: { requireAction?: boolean } = {},
): PublicKnowledge[] {
  if (!options.requireAction && !operationalIntentPattern.test(question)) {
    return [...answers]
  }
  return answers.filter(hasExecutableAction)
}

function normalizedTerms(value: string | null | undefined): Set<string> {
  return new Set(value?.toLowerCase().match(/[a-z0-9]+/g) ?? [])
}

function semanticSearchTerms(
  tokens: readonly string[],
  context: InternalResolvedContext,
): string[] {
  const contextTerms = new Set([
    ...normalizedTerms(context.vendor),
    ...normalizedTerms(context.vendor_slug),
    ...normalizedTerms(context.model),
    ...normalizedTerms(context.platform_slug),
    ...normalizedTerms(context.operating_system),
    ...normalizedTerms(context.operating_system_slug),
    ...normalizedTerms(context.software_family),
    ...normalizedTerms(context.software_family_slug),
    ...normalizedTerms(context.version)
  ])
  return tokens.filter(
    (token) => !contextTerms.has(token) && !nonSemanticSearchTerms.has(token),
  )
}

function toPublicKnowledge(
  row: KnowledgeRow,
  context: ResolvedNetworkContext,
  conflicts: ConflictRow[],
  versionMatch: PublicVersionMatch | undefined,
  contextRelation: ContextRelation,
  documentedVersionRelation: DocumentedVersionRelation,
  widened = false,
): PublicKnowledge {
  const matchLevel = publicMatchLevel(row.scope_level)
  const reference = contextRelation === 'same_vendor' ||
    contextRelation === 'cross_platform' ||
    versionMatch === undefined
  const assuranceLevel = reference
    ? 'best_effort'
    : assuranceFor(row.scope_level, versionMatch)
  const deterministicallyReadOnly = isDeterministicallyReadOnlyPublicCommand(
    row.kind,
    row.command_text,
  )
  const dangerous = deterministicallyReadOnly ? false : row.dangerous
  const requiresPlatformConfirmation =
    !deterministicallyReadOnly && (
      row.requires_platform_confirmation ||
      (row.scope_level !== 'model' && dangerous) ||
      (reference && dangerous)
    )
  const documentedRange = row.version_min || row.version_max
    ? `${row.version_min ?? 'any'}–${row.version_max ?? 'latest'}`
    : 'not specified'
  const additionalLimitations = [
    requiresPlatformConfirmation
      ? 'Stop unless the exact platform and hardware-specific prerequisites are confirmed before applying this operation.'
      : null,
    versionMatch === 'same_branch_fallback'
      ? 'This is the nearest documented patch in the same software branch; confirm release-specific differences before applying it.'
      : null,
    reference
      ? `Exact applicability was not confirmed. This guidance is documented for ${row.vendor_name} ${row.operating_system_name}, version ${documentedRange}; verify command syntax and availability on the requested device before use.`
      : null
  ].filter((value): value is string => Boolean(value))
  return {
    revision_ref: row.public_ref,
    kind: row.kind,
    title: row.title,
    summary: row.summary,
    applicability: {
      vendor: !widened && row.scope_level === 'os_family'
        ? context.vendor
        : row.vendor_name,
      model: !widened && row.scope_level === 'os_family'
        ? context.model
        : row.platform_name,
      operating_system: !widened && row.scope_level === 'os_family'
        ? context.operating_system
        : row.operating_system_name,
      versions: {
        minimum: row.version_min,
        maximum: row.version_max,
        requested: context.version
      },
      match_level: matchLevel,
      context_relation: contextRelation,
      ...(versionMatch ? { version_match: versionMatch } : {}),
      documented_version_relation: documentedVersionRelation,
      assurance_level: assuranceLevel,
      requires_platform_confirmation: requiresPlatformConfirmation
    },
    cli_mode: row.cli_mode,
    command: row.command_text,
    procedure: row.procedure_steps,
    prerequisites: row.prerequisites,
    risks: deterministicallyReadOnly
      ? row.risks.filter((risk) =>
          !/^Legacy risk classification:/i.test(risk) &&
          !/^Deterministic safety classifier enforced risk level/i.test(risk) &&
          !/^CliDeck deterministic guard enforced risk level/i.test(risk)
        )
      : row.risks,
    verification: row.verification_steps,
    rollback: row.rollback_steps,
    last_verified_at: new Date(row.last_verified_at).toISOString().slice(0, 10),
    confidence: Number(row.confidence),
    quality_score: Number(row.quality_score),
    dangerous,
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
    limitations: [...new Set([...row.limitations, ...additionalLimitations])]
  }
}

const versionPriority: Record<PublicVersionMatch, number> = {
  exact: 5,
  explicit_range: 4,
  branch: 3,
  unbounded: 2,
  same_branch_fallback: 1
}

const scopePriority: Record<ApplicabilityScope, number> = {
  model: 4,
  vendor_os: 3,
  architecture: 2,
  os_family: 1
}

const contextPriority: Record<ContextRelation, number> = {
  same_model: 5,
  same_software_family: 4,
  portable: 3,
  same_vendor: 2,
  cross_platform: 1
}

function candidateContextRelation(
  row: KnowledgeRow,
  context: InternalResolvedContext,
): ContextRelation {
  const sameVendor = row.revision_vendor_id !== null &&
    row.revision_vendor_id === context.vendorId
  const sameOperatingSystem = sameVendor &&
    row.operating_system_name.toLowerCase().replace(/[^a-z0-9]+/g, '') ===
      context.operating_system.toLowerCase().replace(/[^a-z0-9]+/g, '')
  const sameFamily = sameOperatingSystem || (
    row.software_family_id !== null &&
    context.softwareFamilyIds.includes(row.software_family_id)
  )
  if (
    sameFamily &&
    row.scope_level === 'model' &&
    row.revision_platform_id !== null &&
    row.revision_platform_id === context.platformId
  ) {
    return 'same_model'
  }
  if (
    sameFamily &&
    row.scope_level === 'vendor_os' &&
    row.revision_vendor_id === context.vendorId
  ) {
    return 'same_software_family'
  }
  if (
    sameFamily &&
    row.scope_level === 'architecture' &&
    row.applicability_architecture_slug === context.architectureSlug
  ) {
    return 'same_software_family'
  }
  if (sameFamily && row.scope_level === 'os_family') {
    return row.portability_mode === 'portable'
      ? 'portable'
      : 'same_software_family'
  }
  if (
    row.revision_vendor_id !== null &&
    sameVendor
  ) {
    return 'same_vendor'
  }
  return 'cross_platform'
}

function documentedVersionRelation(
  row: KnowledgeRow,
  requestedVersion: string | null,
  relation: ContextRelation,
  versionMatch: PublicVersionMatch | undefined,
): DocumentedVersionRelation {
  if (!requestedVersion) return 'unspecified'
  if (versionMatch) return versionMatch === 'same_branch_fallback'
    ? 'different'
    : 'unspecified'
  if (!['same_model', 'same_software_family', 'portable'].includes(relation)) {
    return 'not_comparable'
  }
  const requested = normalizeVendorVersion(requestedVersion)
  if (
    row.version_normalized_max &&
    compareNormalizedVersions(row.version_normalized_max, requested) < 0
  ) {
    return 'older'
  }
  if (
    row.version_normalized_min &&
    compareNormalizedVersions(row.version_normalized_min, requested) > 0
  ) {
    return 'newer'
  }
  if (row.version_normalized_min || row.version_normalized_max) {
    return 'different'
  }
  return 'unspecified'
}

async function searchBroadKnowledgeRows(
  database: Database,
  normalizedQuestion: string,
  strictTsQuery: string,
  relaxedTsQuery: string,
  semanticTerms: readonly string[],
  limit: number,
  kind?: PublicKnowledge['kind'] | PublicKnowledge['kind'][],
  context?: InternalResolvedContext,
  vendorId: string | null = null,
): Promise<KnowledgeRow[]> {
  const terms = semanticTerms.length > 0
    ? semanticTerms
    : normalizedQuestion.toLowerCase().match(/[a-z0-9]+/g) ?? []
  if (terms.length === 0) return []
  const result = await database.query<KnowledgeRow>(
     `SELECT
       revision.id AS revision_id,
       revision.public_ref,
       item.kind,
       revision.vendor_id AS revision_vendor_id,
       revision.platform_id AS revision_platform_id,
       applicability.family_id AS software_family_id,
       family.portability_mode,
       applicability.architecture_slug AS applicability_architecture_slug,
       coalesce(vendor.display_name, 'Not specified') AS vendor_name,
       platform.display_name AS platform_name,
       coalesce(os.display_name, 'Not specified') AS operating_system_name,
       revision.version_min,
       revision.version_max,
       revision.version_normalized_min,
       revision.version_normalized_max,
       coalesce(applicability.scope_level, 'os_family') AS scope_level,
       coalesce(applicability.version_scope, 'unbounded') AS version_scope,
       applicability.version_branch,
       coalesce(family.version_strategy, 'vendor') AS version_strategy,
       coalesce(applicability.requires_platform_confirmation, false)
         AS requires_platform_confirmation,
       coalesce(applicability.portable_semantic_key,
         digest(item.stable_key, 'sha256')) AS portable_semantic_key,
       revision.title, revision.summary, revision.cli_mode,
       revision.command_text, revision.procedure_steps,
       revision.prerequisites, revision.risks, revision.verification_steps,
       revision.rollback_steps, revision.limitations, revision.dangerous,
       revision.confidence, revision.quality_score,
       revision.last_verified_at,
       coalesce(trust.validation_level, 'documentation_reviewed')
         AS validation_level,
       coalesce(trust.independent_confirmations, 1)
         AS independent_confirmations,
       coalesce(trust.confidence_explanation,
         'Source-backed knowledge; device context was widened for retrieval.')
         AS confidence_explanation,
       coalesce(trust.next_review_at, revision.last_verified_at + 180)
         AS next_review_at,
       NULL::timestamptz AS lab_validated_at,
       (ts_rank_cd(revision.search_document, to_tsquery('simple', $2), 32)
         + ts_rank_cd(revision.search_document, to_tsquery('simple', $3), 32)
         + similarity(lower(revision.title), lower($1)) * 0.15
         + revision.confidence::float8 * 0.03
         + revision.quality_score::float8 * 0.03)::float8 AS rank
     FROM active_knowledge_state active
     JOIN knowledge_revisions revision ON revision.id = active.revision_id
     JOIN knowledge_items item ON item.id = active.knowledge_item_id
     LEFT JOIN vendors vendor ON vendor.id = revision.vendor_id
     LEFT JOIN platforms platform ON platform.id = revision.platform_id
     LEFT JOIN operating_systems os ON os.id = revision.operating_system_id
     LEFT JOIN knowledge_applicability_index applicability
       ON applicability.revision_id = revision.id
     LEFT JOIN software_families family ON family.id = applicability.family_id
     LEFT JOIN knowledge_public_trust trust ON trust.revision_id = revision.id
     WHERE item.domain_id = 'network' AND revision.domain_id = 'network'
       AND ($4::text[] IS NULL OR item.kind = ANY($4))
       AND ($7::uuid IS NULL OR revision.vendor_id = $7)
       AND NOT EXISTS (
         SELECT 1
         FROM knowledge_applicability_exclusions exclusion
         WHERE exclusion.revision_id = revision.id
           AND (exclusion.vendor_id IS NULL OR exclusion.vendor_id = $8)
           AND (exclusion.platform_id IS NULL OR exclusion.platform_id = $9)
           AND (
             (exclusion.version_min IS NULL AND exclusion.version_max IS NULL)
             OR (
               $10::integer[] IS NOT NULL
               AND (
                 exclusion.version_normalized_min IS NULL
                 OR $10::integer[] >= exclusion.version_normalized_min
               )
               AND (
                 exclusion.version_normalized_max IS NULL
                 OR $10::integer[] <= exclusion.version_normalized_max
               )
             )
           )
       )
       AND (
         revision.search_document @@ to_tsquery('simple', $2)
         OR revision.search_document @@ to_tsquery('simple', $3)
         OR lower(revision.title) % lower($1)
       )
       AND (SELECT count(*) FROM unnest($5::text[]) term
              WHERE revision.search_document @@
                to_tsquery('simple', term || ':*')) >= 1
     ORDER BY rank DESC, revision.last_verified_at DESC
     LIMIT $6`,
    [
      normalizedQuestion,
      strictTsQuery,
      relaxedTsQuery,
      kind ? Array.isArray(kind) ? kind : [kind] : null,
      terms,
      Math.max(limit * 4, 20),
      vendorId,
      context?.vendorId ?? null,
      context?.platformId ?? null,
      context?.version ? normalizeVendorVersion(context.version) : null
    ],
  )
  return result.rows
}

export async function searchKnowledge(
  database: Database,
  question: string,
  context: InternalResolvedContext,
  limit: number,
  kind?: PublicKnowledge['kind'] | PublicKnowledge['kind'][],
  capabilityMatcher?: CapabilityMatcher,
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
  const minimumSemanticMatches = semanticTerms.length > 0 ? 1 : 0
  const isRelevant = (row: KnowledgeRow) =>
    hasMinimumSemanticRelevance(semanticTerms, row) ||
    Boolean(capabilityMatcher?.(row))
  const result = minimumSemanticMatches === 0
    ? { rows: [] as KnowledgeRow[] }
    : await database.query<KnowledgeRow>(
    `WITH ranked_revisions AS MATERIALIZED (
       SELECT
         kr.id AS revision_id,
         active.knowledge_item_id,
         (
           ts_rank_cd(kr.search_document, to_tsquery('simple', $7), 32) * 0.70
           + ts_rank_cd(
               kr.search_document,
               to_tsquery('simple', $8),
               32
             ) * 0.30
           + similarity(lower(kr.title), lower($1)) * 0.15
           + kr.confidence::float8 * 0.10
           + kr.quality_score::float8 * 0.10
           + CASE applicability.scope_level
               WHEN 'model' THEN 0.30
               WHEN 'vendor_os' THEN 0.20
               WHEN 'architecture' THEN 0.15
               ELSE 0.05
             END
         )::float8 AS rank,
         (
           SELECT count(*)::integer
           FROM unnest($9::text[]) AS semantic_term
           WHERE kr.search_document @@ to_tsquery(
             'simple', semantic_term || ':*'
           )
         ) AS semantic_matches
       FROM knowledge_revisions kr
       JOIN active_knowledge_state active ON active.revision_id = kr.id
       JOIN knowledge_items ki ON ki.id = active.knowledge_item_id
       JOIN knowledge_applicability_index applicability
         ON applicability.revision_id = kr.id
       WHERE ki.domain_id = 'network'
         AND kr.domain_id = 'network'
         AND applicability.family_id = ANY($2::uuid[])
         AND (
           applicability.scope_level = 'os_family'
           OR (
             applicability.scope_level = 'vendor_os'
             AND $3::uuid IS NOT NULL
             AND applicability.vendor_id = $3
           )
           OR (
             applicability.scope_level = 'model'
             AND $4::uuid IS NOT NULL
             AND applicability.platform_id = $4
           )
           OR (
             applicability.scope_level = 'architecture'
             AND $5::text IS NOT NULL
             AND applicability.architecture_slug = $5
           )
         )
         AND NOT EXISTS (
           SELECT 1
           FROM knowledge_applicability_exclusions exclusion
           WHERE exclusion.revision_id = kr.id
             AND (exclusion.vendor_id IS NULL OR exclusion.vendor_id = $3)
             AND (exclusion.platform_id IS NULL OR exclusion.platform_id = $4)
             AND (
               (
                 exclusion.version_min IS NULL
                 AND exclusion.version_max IS NULL
               )
               OR (
                 $11::integer[] IS NOT NULL
                 AND (
                   exclusion.version_normalized_min IS NULL
                   OR $11::integer[] >= exclusion.version_normalized_min
                 )
                 AND (
                   exclusion.version_normalized_max IS NULL
                   OR $11::integer[] <= exclusion.version_normalized_max
                 )
               )
             )
         )
         AND ($6::text[] IS NULL OR ki.kind = ANY($6))
         AND (
           kr.search_document @@ to_tsquery('simple', $7)
           OR kr.search_document @@ to_tsquery('simple', $8)
           OR (
             lower(kr.title) % lower($1)
             AND similarity(lower(kr.title), lower($1)) >= 0.32
           )
         )
       ORDER BY rank DESC, kr.confidence DESC, kr.last_verified_at DESC
       LIMIT 100
     )
     SELECT
       rr.revision_id,
       kr.public_ref,
       ki.kind,
       kr.vendor_id AS revision_vendor_id,
       kr.platform_id AS revision_platform_id,
       applicability.family_id AS software_family_id,
       software_family.portability_mode,
       applicability.architecture_slug AS applicability_architecture_slug,
       v.display_name AS vendor_name,
       p.display_name AS platform_name,
       coalesce(os.display_name, 'Not specified') AS operating_system_name,
       kr.version_min,
       kr.version_max,
       kr.version_normalized_min,
       kr.version_normalized_max,
       applicability.scope_level,
       applicability.version_scope,
       applicability.version_branch,
       software_family.version_strategy,
       applicability.requires_platform_confirmation,
       applicability.portable_semantic_key,
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
             'batfish_modeled', 'runtime_lab_validated'
           ) THEN 'documentation_reviewed'
           ELSE kpt.validation_level
         END,
         'documentation_reviewed'
       ) AS validation_level,
       coalesce(kpt.independent_confirmations, 1) AS independent_confirmations,
       coalesce(
         kpt.confidence_explanation,
         'Verified structured knowledge with bounded applicability.'
       ) AS confidence_explanation,
       coalesce(kpt.next_review_at, kr.last_verified_at + 180)
         AS next_review_at,
       current_validation.lab_validated_at,
       rr.rank
     FROM ranked_revisions rr
     JOIN knowledge_revisions kr ON kr.id = rr.revision_id
     JOIN knowledge_items ki ON ki.id = rr.knowledge_item_id
     JOIN knowledge_applicability_index applicability
       ON applicability.revision_id = kr.id
     JOIN software_families software_family
       ON software_family.id = applicability.family_id
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
       AND rr.semantic_matches >= $10
     ORDER BY rr.rank DESC, kr.confidence DESC, kr.last_verified_at DESC`,
    [
      search.normalizedQuestion,
      context.softwareFamilyIds,
      context.vendorId,
      context.platformId,
      context.architectureSlug,
      kind ? Array.isArray(kind) ? kind : [kind] : null,
      search.strictTsQuery,
      search.relaxedTsQuery,
      semanticTerms,
      minimumSemanticMatches,
      context.version ? normalizeVendorVersion(context.version) : null
    ],
  )

  const exactRows = result.rows
    .flatMap((row) => {
      if (!isRelevant(row)) return []
      const versionMatch = matchVersionApplicability({
        requested: context.version,
        minimum: row.version_normalized_min,
        maximum: row.version_normalized_max,
        versionScope: row.version_scope,
        versionBranch: row.version_branch,
        versionStrategy: row.version_strategy
      })
      if (!versionMatch) return []
      const contextRelation = candidateContextRelation(row, context)
      return [{
        row,
        versionMatch,
        contextRelation,
        documentedVersionRelation: documentedVersionRelation(
          row,
          context.version,
          contextRelation,
          versionMatch,
        ),
        widened: false
      }]
    })
    .sort((left, right) =>
      contextPriority[right.contextRelation] -
        contextPriority[left.contextRelation] ||
      versionPriority[right.versionMatch] -
        versionPriority[left.versionMatch] ||
      scopePriority[right.row.scope_level] -
        scopePriority[left.row.scope_level] ||
      Number(right.row.rank) - Number(left.row.rank),
    )
    .filter((entry, index, entries) => {
      const key = Buffer.from(entry.row.portable_semantic_key).toString('hex')
      return entries.findIndex((candidate) =>
        Buffer.from(candidate.row.portable_semantic_key).toString('hex') === key
      ) === index
    })
  const vendorBroadRows = context.vendorId
    ? await searchBroadKnowledgeRows(
        database,
        search.normalizedQuestion,
        search.strictTsQuery,
        search.relaxedTsQuery,
        semanticTerms,
        limit,
        kind,
        context,
        context.vendorId,
      )
    : []
  const relevantVendorBroadRows = vendorBroadRows.filter(isRelevant)
  const needGlobalRows = exactRows.length + relevantVendorBroadRows.length < limit
  const globalBroadRows = needGlobalRows
    ? await searchBroadKnowledgeRows(
        database,
        search.normalizedQuestion,
        search.strictTsQuery,
        search.relaxedTsQuery,
        semanticTerms,
        limit,
        kind,
        context,
      )
    : []
  const broadRows = [
    ...relevantVendorBroadRows,
    ...globalBroadRows.filter(isRelevant)
  ]
  const seen = new Set(exactRows.map(({ row }) =>
    Buffer.from(row.portable_semantic_key).toString('hex'),
  ))
  const applicableRows = [
    ...exactRows,
    ...broadRows
      .filter((row, index, rows) => {
        const key = Buffer.from(row.portable_semantic_key).toString('hex')
        return !seen.has(key) && rows.findIndex((candidate) =>
          Buffer.from(candidate.portable_semantic_key).toString('hex') === key
        ) === index
      })
      .map((row) => {
        const contextRelation = candidateContextRelation(row, context)
        const comparable = [
          'same_model', 'same_software_family', 'portable'
        ].includes(contextRelation)
        const versionMatch = comparable
          ? matchVersionApplicability({
              requested: context.version,
              minimum: row.version_normalized_min,
              maximum: row.version_normalized_max,
              versionScope: row.version_scope,
              versionBranch: row.version_branch,
              versionStrategy: row.version_strategy
            }) ?? undefined
          : undefined
        return {
          row,
          versionMatch,
          contextRelation,
          documentedVersionRelation: documentedVersionRelation(
            row,
            context.version,
            contextRelation,
            versionMatch,
          ),
          widened: true
        }
      })
  ].sort((left, right) =>
    questionRelevanceScore(question, right.row) -
      questionRelevanceScore(question, left.row) ||
    contextPriority[right.contextRelation] -
      contextPriority[left.contextRelation] ||
    (right.versionMatch ? versionPriority[right.versionMatch] : 0) -
      (left.versionMatch ? versionPriority[left.versionMatch] : 0) ||
    scopePriority[right.row.scope_level] - scopePriority[left.row.scope_level] ||
    Number(right.row.rank) - Number(left.row.rank),
  ).slice(0, limit)

  if (applicableRows.length === 0) return []
  const revisionIds = applicableRows.map(({ row }) => row.revision_id)
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
  return applicableRows.map(({
    row,
    versionMatch,
    contextRelation,
    documentedVersionRelation,
    widened
  }) =>
    toPublicKnowledge(
      row,
      context,
      conflicts.rows,
      versionMatch,
      contextRelation,
      documentedVersionRelation,
      widened,
    ),
  )
}

export async function getPublicRevision(
  database: Database,
  revisionId: string,
  requestedVersion: string | null = null,
): Promise<PublicKnowledge | null> {
  const result = await database.query<KnowledgeRow>(
     `SELECT
       pak.*,
       kr.public_ref,
       kr.vendor_id AS revision_vendor_id,
       kr.platform_id AS revision_platform_id,
       applicability.family_id AS software_family_id,
       software_family.portability_mode,
       applicability.architecture_slug AS applicability_architecture_slug,
       coalesce(applicability.scope_level, 'os_family') AS scope_level,
       coalesce(applicability.version_scope, 'unbounded') AS version_scope,
       applicability.version_branch,
       coalesce(software_family.version_strategy, 'vendor') AS version_strategy,
       coalesce(applicability.requires_platform_confirmation, false)
         AS requires_platform_confirmation,
       coalesce(applicability.portable_semantic_key,
         digest(ki.stable_key, 'sha256')) AS portable_semantic_key,
       1::float8 AS rank
     FROM public_active_knowledge pak
     JOIN knowledge_revisions kr ON kr.id = pak.revision_id
     JOIN knowledge_items ki ON ki.id = kr.knowledge_item_id
     LEFT JOIN knowledge_applicability_index applicability
       ON applicability.revision_id = kr.id
     LEFT JOIN software_families software_family
       ON software_family.id = applicability.family_id
     WHERE pak.revision_id = $1 OR kr.public_ref = $1`,
    [revisionId],
  )
  const row = result.rows[0]
  if (!row) return null
  const versionMatch = matchVersionApplicability({
    requested: requestedVersion,
    minimum: row.version_normalized_min,
    maximum: row.version_normalized_max,
    versionScope: row.version_scope,
    versionBranch: row.version_branch,
    versionStrategy: row.version_strategy
  }) ?? undefined
  const contextRelation: ContextRelation = row.portability_mode === 'portable'
    ? 'portable'
    : row.revision_platform_id
      ? 'same_model'
      : 'same_software_family'
  return toPublicKnowledge(
    row,
    {
      vendor: row.vendor_name,
      vendor_slug: '',
      model: row.platform_name,
      platform_slug: null,
      operating_system: row.operating_system_name,
      operating_system_slug: '',
      software_family: row.operating_system_name,
      software_family_slug: '',
      portable_operating_system: row.scope_level === 'os_family',
      vendor_resolved: true,
      model_resolved: Boolean(row.platform_name),
      version: requestedVersion,
      applicable_version: requestedVersion ?? 'Version not supplied',
      resolution_confidence: 1,
      ambiguities: []
    },
    [],
    versionMatch,
    contextRelation,
    documentedVersionRelation(
      row,
      requestedVersion,
      contextRelation,
      versionMatch,
    ),
  )
}
