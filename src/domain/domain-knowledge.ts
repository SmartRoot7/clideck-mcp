import {
  coreKnowledgeRevisionSchema,
  enforceCoreCandidatePolicy,
  exportDomainPackJsonSchemas,
  jsonObjectSchema,
  type CoreKnowledgeRevision,
  type DomainPackJsonSchemas,
  type DomainPackManifestV1
} from '@clideck/domain-kit'

import type { DatabaseClient } from '../db.js'
import { getDomainPackRegistry } from './domain-packs.js'

type DatabaseQueryable = Pick<DatabaseClient, 'query'>

type DomainPackCatalogRow = {
  manifest_schema_version: string
  pack_version: string
  enabled: boolean
}

type ExistingItemRow = {
  id: string
  domain_id: string
  kind: string
}

type DomainKnowledgeRow = {
  revision_id: string
  public_ref: string
  revision_number: number
  release_sequence: number
  domain_id: string
  domain_schema_version: string
  stable_key: string
  record_type: string
  title: string
  summary: string
  question_patterns: string[]
  domain_context: Record<string, unknown>
  domain_payload: Record<string, unknown>
  prerequisites: string[]
  risks: string[]
  verification_steps: string[]
  rollback_steps: string[]
  limitations: string[]
  dangerous: boolean
  risk_level: CoreKnowledgeRevision['risk_level']
  confidence: string | number
  quality_score: string | number
  confidence_reason: string
  last_verified_at: string
  validation_level: string
  independent_confirmations: number
  next_review_at: string
  provenance: unknown
  conflicts: unknown
  relevance: string | number
}

export type DomainRevisionReference = {
  itemId: string
  revisionId: string
  created: boolean
}

export type DomainKnowledgeSearchResult = {
  domain_id: string
  context: Record<string, unknown>
  records: unknown[]
}

async function assertInstalledPack(
  client: DatabaseQueryable,
  domainId: string,
): Promise<void> {
  const pack = getDomainPackRegistry().get(domainId)
  const catalog = await client.query<DomainPackCatalogRow>(
    `SELECT manifest_schema_version, pack_version, enabled
     FROM domain_packs
     WHERE id = $1`,
    [domainId],
  )
  const installed = catalog.rows[0]
  if (!installed || !installed.enabled) {
    throw new Error(`DOMAIN_PACK_NOT_ENABLED:${domainId}`)
  }
  if (
    installed.manifest_schema_version !== pack.manifest.schema_version ||
    installed.pack_version !== pack.manifest.version
  ) {
    throw new Error(`DOMAIN_PACK_CATALOG_VERSION_MISMATCH:${domainId}`)
  }
}

export async function createDomainKnowledgeRevision(
  client: DatabaseQueryable,
  domainId: string,
  unparsedCandidate: unknown,
): Promise<DomainRevisionReference> {
  const pack = getDomainPackRegistry().get(domainId)
  await assertInstalledPack(client, domainId)
  const candidate = pack.candidateSchema.parse(unparsedCandidate)
  const validation = pack.validateCandidate(candidate)
  if (!validation.valid) {
    throw new Error(
      `DOMAIN_CANDIDATE_INVALID:${domainId}:${validation.issues
        .map((issue) => issue.code)
        .join(',')}`,
    )
  }
  const core = enforceCoreCandidatePolicy(pack.toCoreCandidate(candidate))
  if (core.domain_id !== domainId) {
    throw new Error(`DOMAIN_CANDIDATE_PACK_MISMATCH:${domainId}`)
  }

  const inserted = await client.query<ExistingItemRow>(
    `INSERT INTO knowledge_items (domain_id, stable_key, kind)
     VALUES ($1, $2, $3)
     ON CONFLICT (stable_key) DO NOTHING
     RETURNING id, domain_id, kind`,
    [domainId, core.stable_key, core.record_type],
  )
  const item = inserted.rows[0] ?? (
    await client.query<ExistingItemRow>(
      `SELECT id, domain_id, kind
       FROM knowledge_items
       WHERE stable_key = $1
       FOR UPDATE`,
      [core.stable_key],
    )
  ).rows[0]
  if (
    !item ||
    item.domain_id !== domainId ||
    item.kind !== core.record_type
  ) {
    throw new Error('DOMAIN_STABLE_KEY_CONFLICT')
  }

  const existing = await client.query<{ id: string }>(
    `SELECT id
     FROM knowledge_revisions
     WHERE knowledge_item_id = $1
       AND domain_id = $2
       AND domain_schema_version = $3
       AND domain_context = $4::jsonb
       AND domain_payload = $5::jsonb
       AND title = $6
       AND summary = $7
       AND question_patterns = $8::text[]
       AND prerequisites = $9::jsonb
       AND risks = $10::jsonb
       AND verification_steps = $11::jsonb
       AND rollback_steps = $12::jsonb
       AND limitations = $13::jsonb
       AND dangerous = $14
       AND risk_level = $15
       AND confidence = $16
       AND quality_score = $17
       AND last_verified_at = $18::date
       AND status = 'validated'
     ORDER BY revision_number DESC
     LIMIT 1`,
    [
      item.id,
      domainId,
      core.schema_version,
      JSON.stringify(core.context),
      JSON.stringify(core.payload),
      core.title,
      core.summary,
      core.question_patterns,
      JSON.stringify(core.prerequisites),
      JSON.stringify(core.risks),
      JSON.stringify(core.verification),
      JSON.stringify(core.rollback),
      JSON.stringify(core.limitations),
      core.dangerous,
      core.risk_level,
      core.confidence,
      core.quality_score,
      core.last_verified_at
    ],
  )
  if (existing.rows[0]) {
    return {
      itemId: item.id,
      revisionId: existing.rows[0].id,
      created: false
    }
  }

  const nextRevision = await client.query<{ next_revision: number }>(
    `SELECT coalesce(max(revision_number), 0)::int + 1 AS next_revision
     FROM knowledge_revisions
     WHERE knowledge_item_id = $1`,
    [item.id],
  )
  const revision = await client.query<{ id: string }>(
    `INSERT INTO knowledge_revisions (
       knowledge_item_id,
       domain_id,
       domain_schema_version,
       domain_context,
       domain_payload,
       revision_number,
       status,
       title,
       summary,
       question_patterns,
       procedure_steps,
       prerequisites,
       risks,
       verification_steps,
       rollback_steps,
       limitations,
       dangerous,
       risk_level,
       confidence,
       quality_score,
       confidence_reason,
       last_verified_at,
       created_by
     )
     VALUES (
       $1, $2, $3, $4::jsonb, $5::jsonb, $6, 'validated',
       $7, $8, $9::text[], '[]'::jsonb, $10::jsonb, $11::jsonb,
       $12::jsonb, $13::jsonb, $14::jsonb, $15, $16, $17, $18,
       $19, $20::date, 'super_admin'
     )
     RETURNING id`,
    [
      item.id,
      domainId,
      core.schema_version,
      JSON.stringify(core.context),
      JSON.stringify(core.payload),
      nextRevision.rows[0]!.next_revision,
      core.title,
      core.summary,
      core.question_patterns,
      JSON.stringify(core.prerequisites),
      JSON.stringify(core.risks),
      JSON.stringify(core.verification),
      JSON.stringify(core.rollback),
      JSON.stringify(core.limitations),
      core.dangerous,
      core.risk_level,
      core.confidence,
      core.quality_score,
      core.confidence_reason,
      core.last_verified_at
    ],
  )
  const revisionId = revision.rows[0]!.id

  for (const source of core.provenance) {
    const document = await client.query<{ id: string }>(
      `INSERT INTO source_documents (
         domain_id,
         canonical_url,
         document_type,
         title,
         document_version,
         document_date,
         verified_at,
         content_hash,
         evidence_fragment
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (domain_id, canonical_url, content_hash)
       DO UPDATE SET verified_at = greatest(
         source_documents.verified_at,
         excluded.verified_at
       )
       RETURNING id`,
      [
        domainId,
        source.url,
        source.document_type,
        source.title,
        source.document_version ?? null,
        source.document_date ?? null,
        source.verified_at,
        source.content_hash,
        source.evidence_fragment
      ],
    )
    await client.query(
      `INSERT INTO revision_sources (
         revision_id,
         source_document_id,
         evidence_role,
         confidence_reason
       )
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (revision_id, source_document_id) DO NOTHING`,
      [
        revisionId,
        document.rows[0]!.id,
        source.evidence_role,
        core.confidence_reason
      ],
    )
  }

  await client.query(
    `INSERT INTO knowledge_public_trust (
       revision_id,
       validation_level,
       independent_confirmations,
       confidence_explanation,
       next_review_at
     )
     VALUES (
       $1,
       'deterministic_validation',
       $2,
       $3,
       $4::date + CASE WHEN $5 THEN 90 ELSE 180 END
     )`,
    [
      revisionId,
      core.provenance.length,
      core.confidence_reason,
      core.last_verified_at,
      core.dangerous
    ],
  )

  return { itemId: item.id, revisionId, created: true }
}

function normalizeDate(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  return String(value).slice(0, 10)
}

function toCoreRevision(row: DomainKnowledgeRow): CoreKnowledgeRevision {
  return coreKnowledgeRevisionSchema.parse({
    domain_id: row.domain_id,
    schema_version: row.domain_schema_version,
    stable_key: row.stable_key,
    record_type: row.record_type,
    title: row.title,
    summary: row.summary,
    question_patterns: row.question_patterns,
    context: row.domain_context,
    payload: row.domain_payload,
    prerequisites: row.prerequisites,
    risks: row.risks,
    verification: row.verification_steps,
    rollback: row.rollback_steps,
    limitations: row.limitations,
    dangerous: row.dangerous,
    risk_level: row.risk_level,
    confidence: Number(row.confidence),
    quality_score: Number(row.quality_score),
    confidence_reason: row.confidence_reason,
    last_verified_at: normalizeDate(row.last_verified_at),
    provenance: row.provenance,
    revision_ref: row.public_ref,
    revision_number: Number(row.revision_number),
    release_sequence: Number(row.release_sequence),
    assurance: {
      validation_level: row.validation_level,
      independent_confirmations: Number(row.independent_confirmations),
      next_review_at: normalizeDate(row.next_review_at)
    },
    conflicts: row.conflicts
  })
}

export async function searchDomainKnowledge(
  client: DatabaseQueryable,
  input: {
    domainId: string
    question: string
    context?: unknown
    limit?: number
  },
): Promise<DomainKnowledgeSearchResult> {
  const pack = getDomainPackRegistry().get(input.domainId)
  await assertInstalledPack(client, input.domainId)
  const context = pack.normalizeContext(input.context ?? {})
  const limit = Math.max(1, Math.min(input.limit ?? 5, 20))
  const result = await client.query<DomainKnowledgeRow>(
    `SELECT
       kr.id AS revision_id,
       kr.public_ref,
       kr.revision_number,
       release.sequence AS release_sequence,
       ki.domain_id,
       kr.domain_schema_version,
       ki.stable_key,
       ki.kind AS record_type,
       kr.title,
       kr.summary,
       kr.question_patterns,
       kr.domain_context,
       kr.domain_payload,
       kr.prerequisites,
       kr.risks,
       kr.verification_steps,
       kr.rollback_steps,
       kr.limitations,
       kr.dangerous,
       kr.risk_level,
       kr.confidence,
       kr.quality_score,
       kr.confidence_reason,
       kr.last_verified_at,
       coalesce(
         current_validation.validation_level,
         CASE
           WHEN trust.validation_level IN (
             'batfish_modeled',
             'runtime_lab_validated'
           )
             THEN 'documentation_reviewed'
           ELSE trust.validation_level
         END,
         'documentation_reviewed'
       ) AS validation_level,
       coalesce(trust.independent_confirmations, 1)
         AS independent_confirmations,
       coalesce(trust.next_review_at, kr.last_verified_at + 180)
         AS next_review_at,
       coalesce(provenance.items, '[]'::json) AS provenance,
       coalesce(conflicts.items, '[]'::json) AS conflicts,
       (
         ts_rank_cd(
           kr.search_document,
           websearch_to_tsquery('simple', $2)
         ) * 10 +
         similarity(lower(kr.title), lower($2)) * 2 +
         similarity(lower(kr.summary), lower($2))
       ) AS relevance
     FROM active_release active
     JOIN releases release ON release.id = active.release_id
     JOIN release_items release_item
       ON release_item.release_id = active.release_id
     JOIN knowledge_items ki
       ON ki.id = release_item.knowledge_item_id
     JOIN knowledge_revisions kr
       ON kr.id = release_item.revision_id
     LEFT JOIN knowledge_public_trust trust ON trust.revision_id = kr.id
     LEFT JOIN LATERAL current_knowledge_validation(kr.id)
       current_validation ON true
     LEFT JOIN LATERAL (
       SELECT json_agg(json_strip_nulls(json_build_object(
         'url', document.canonical_url,
         'document_type', document.document_type,
         'title', document.title,
         'document_version', document.document_version,
         'document_date', document.document_date,
         'verified_at', document.verified_at,
         'content_hash', document.content_hash,
         'evidence_fragment', document.evidence_fragment,
         'evidence_role', revision_source.evidence_role
       )) ORDER BY document.id) AS items
       FROM revision_sources revision_source
       JOIN source_documents document
         ON document.id = revision_source.source_document_id
       WHERE revision_source.revision_id = kr.id
     ) provenance ON true
     LEFT JOIN LATERAL (
       SELECT json_agg(json_build_object(
         'severity', conflict.severity,
         'description', conflict.description
       ) ORDER BY conflict.created_at) AS items
       FROM knowledge_conflicts conflict
       WHERE conflict.status = 'open'
         AND (
           conflict.left_revision_id = kr.id OR
           conflict.right_revision_id = kr.id
         )
     ) conflicts ON true
     WHERE ki.domain_id = $1
       AND kr.domain_id = $1
       AND kr.domain_context @> $3::jsonb
       AND (
         kr.search_document @@ websearch_to_tsquery('simple', $2) OR
         lower(kr.title) % lower($2) OR
         lower(kr.summary) % lower($2)
       )
     ORDER BY relevance DESC, kr.quality_score DESC, kr.id
     LIMIT $4`,
    [
      input.domainId,
      input.question.trim(),
      JSON.stringify(context),
      limit
    ],
  )

  return {
    domain_id: input.domainId,
    context: jsonObjectSchema.parse(context),
    records: result.rows.map((row) => {
      const record = pack.fromCoreRevision(toCoreRevision(row))
      return pack.publicRecordSchema.parse(record)
    })
  }
}

export async function listKnowledgeDomains(
  client: DatabaseQueryable,
): Promise<DomainPackManifestV1[]> {
  const installed = await client.query<DomainPackCatalogRow & { id: string }>(
    `SELECT id, manifest_schema_version, pack_version, enabled
     FROM domain_packs
     WHERE enabled
     ORDER BY id`,
  )
  const installedById = new Map(
    installed.rows.map((row) => [row.id, row]),
  )
  return getDomainPackRegistry().list().filter((manifest) => {
    const catalog = installedById.get(manifest.id)
    return Boolean(
      catalog &&
      catalog.manifest_schema_version === manifest.schema_version &&
      catalog.pack_version === manifest.version,
    )
  })
}

export async function describeKnowledgeDomain(
  client: DatabaseQueryable,
  domainId: string,
): Promise<{
  manifest: DomainPackManifestV1
  schemas: Pick<DomainPackJsonSchemas, 'context' | 'public_record'>
}> {
  await assertInstalledPack(client, domainId)
  const pack = getDomainPackRegistry().get(domainId)
  const schemas = exportDomainPackJsonSchemas(pack)
  return {
    manifest: pack.manifest,
    schemas: {
      context: schemas.context,
      public_record: schemas.public_record
    }
  }
}
