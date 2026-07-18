import { z } from 'zod'

import type { AppConfig } from '../config.js'
import {
  randomUrlToken,
  sha256,
  sha256Label
} from '../crypto.js'
import type { Database, DatabaseClient } from '../db.js'
import { withTransaction } from '../db.js'
import { assertSafeProvenanceUrl } from '../security/url-policy.js'
import { normalizeVendorVersion } from '../version.js'
import { candidateRevisionSchema } from './schemas.js'
import { enforceKnowledgeRisk } from './risk.js'

const pipelineLeaseSchema = z.object({
  pipeline_task_id: z.string().uuid(),
  lease_token: z.string().min(32).max(128)
})

export const discoverySourceSchema = z.object({
  canonical_url: z.url().startsWith('https://'),
  document_type: z.string().trim().min(1).max(80),
  title: z.string().trim().min(1).max(500),
  document_version: z.string().trim().min(1).max(160).optional(),
  document_date: z.iso.date().optional()
})

const discoveryArtifactShape = {
  sources: z.array(discoverySourceSchema).max(10),
  rejection_reason: z.string().trim().min(12).max(1_000).optional()
}
const hasDiscoveryResult = (
  value: z.infer<z.ZodObject<typeof discoveryArtifactShape>>,
) => value.sources.length > 0 || Boolean(value.rejection_reason)

export const discoveryArtifactSchema = z.object(discoveryArtifactShape).refine(
  hasDiscoveryResult,
  'A discovery run must submit a source or an explicit rejection reason.',
)

export const discoverySubmissionSchema = pipelineLeaseSchema.extend(
  discoveryArtifactShape,
).refine(
  (value) => value.sources.length > 0 || Boolean(value.rejection_reason),
  'A discovery run must submit a source or an explicit rejection reason.',
)

export const pipelineCandidatePayloadSchema = candidateRevisionSchema.omit({
  task_id: true,
  lease_token: true
})

const candidateAnalysisArtifactShape = {
  candidates: z.array(z.object({
    fragment_id: z.string().uuid(),
    candidate: pipelineCandidatePayloadSchema
  })).max(50),
  rejected_fragments: z.array(z.object({
    fragment_id: z.string().uuid(),
    reason: z.string().trim().min(8).max(500)
  })).max(50).default([])
}
const requireHandledAnalysisArtifact = (
  value: z.infer<z.ZodObject<typeof candidateAnalysisArtifactShape>>,
  context: z.RefinementCtx,
) => {
  const handled = new Set([
    ...value.candidates.map((entry) => entry.fragment_id),
    ...value.rejected_fragments.map((entry) => entry.fragment_id)
  ])
  if (handled.size === 0) {
    context.addIssue({
      code: 'custom',
      message:
        'Every analysis run must create a candidate or explicitly reject a fragment.'
    })
  }
}

export const candidateAnalysisArtifactSchema = z.object(
  candidateAnalysisArtifactShape,
).superRefine(requireHandledAnalysisArtifact)

const stableKeyPattern = /^[a-z0-9][a-z0-9._-]{2,159}$/

function normalizeStableKey(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[^a-z0-9]+/, '')
    .replace(/[._-]{2,}/g, '-')
    .replace(/[._-]+$/, '')
    .slice(0, 160)
    .replace(/[._-]+$/, '')

  return stableKeyPattern.test(normalized) ? normalized : value
}

export function normalizeCandidateAnalysisStableKeys(
  unparsedArtifact: unknown,
): unknown {
  if (
    !unparsedArtifact ||
    typeof unparsedArtifact !== 'object' ||
    Array.isArray(unparsedArtifact)
  ) {
    return unparsedArtifact
  }

  const artifact = unparsedArtifact as Record<string, unknown>
  if (!Array.isArray(artifact['candidates'])) return unparsedArtifact

  return {
    ...artifact,
    candidates: artifact['candidates'].map((entry) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        return entry
      }
      const candidateEntry = entry as Record<string, unknown>
      const candidate = candidateEntry['candidate']
      if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
        return entry
      }
      const candidateRecord = candidate as Record<string, unknown>
      const stableKey = candidateRecord['stable_key']
      if (typeof stableKey !== 'string') return entry

      return {
        ...candidateEntry,
        candidate: {
          ...candidateRecord,
          stable_key: normalizeStableKey(stableKey)
        }
      }
    })
  }
}

export const candidateAnalysisSubmissionSchema = pipelineLeaseSchema.extend(
  candidateAnalysisArtifactShape,
).superRefine(requireHandledAnalysisArtifact)

const candidateVerificationDecisionShape = {
  decision: z.enum([
    'verified',
    'rejected',
    'conflict',
    'manual_review'
  ]),
  confidence: z.number().min(0).max(1),
  quality_score: z.number().min(0).max(1),
  findings: z.array(
    z.string().trim().min(1).max(1_000),
  ).max(30).default([])
}

const candidateVerificationArtifactShape = {
  decisions: z.array(z.object({
    candidate_id: z.string().uuid(),
    ...candidateVerificationDecisionShape
  })).min(1).max(100)
}

export const candidateVerificationArtifactSchema = z.object(
  candidateVerificationArtifactShape,
)

export const candidateVerificationSubmissionSchema =
  pipelineLeaseSchema.extend(candidateVerificationArtifactShape)

export const candidateVerificationAgentArtifactSchema = z.object({
  decisions: z.array(z.object({
    candidate_index: z.number().int().min(0).max(99),
    ...candidateVerificationDecisionShape
  })).min(1).max(100)
})

export function materializeCandidateVerificationArtifact(
  unparsedArtifact: unknown,
  candidateIds: string[],
): z.infer<typeof candidateVerificationArtifactSchema> {
  const artifact = candidateVerificationAgentArtifactSchema.parse(
    unparsedArtifact,
  )
  const indexes = new Set(
    artifact.decisions.map((decision) => decision.candidate_index),
  )
  if (
    indexes.size !== artifact.decisions.length ||
    [...indexes].some((index) => index >= candidateIds.length)
  ) {
    throw new Error(
      'Verification artifact candidate indexes must be unique and leased.',
    )
  }
  return candidateVerificationArtifactSchema.parse({
    decisions: artifact.decisions.map((decision) => {
      const {
        candidate_index: candidateIndex,
        ...result
      } = decision
      return {
        candidate_id: candidateIds[candidateIndex],
        ...result
      }
    })
  })
}

export const expertResearchArtifactSchema = z.union([
  pipelineCandidatePayloadSchema,
  z.object({
    rejected: z.literal(true),
    reason: z.string().trim().min(12).max(1_000)
  })
])

export const expertResearchStructuredArtifactSchema = z.object({
  outcome: z.enum(['candidate', 'rejected']),
  candidate: pipelineCandidatePayloadSchema.nullable(),
  reason: z.string().trim().min(12).max(1_000).nullable()
}).superRefine((value, context) => {
  if (value.outcome === 'candidate' && !value.candidate) {
    context.addIssue({
      code: 'custom',
      path: ['candidate'],
      message: 'A candidate outcome requires a candidate.'
    })
  }
  if (value.outcome === 'rejected' && !value.reason) {
    context.addIssue({
      code: 'custom',
      path: ['reason'],
      message: 'A rejected outcome requires a reason.'
    })
  }
})

export const pipelineFailureSchema = pipelineLeaseSchema.extend({
  failure_code: z.string().regex(/^[A-Z][A-Z0-9_]{2,63}$/),
  failure_message: z.string().trim().min(8).max(1_000)
})

export const agentRunResultSchema = z.object({
  agent_run_id: z.string().uuid(),
  status: z.enum(['completed', 'failed', 'timed_out', 'cancelled']),
  input_tokens: z.number().int().min(0),
  cached_input_tokens: z.number().int().min(0).default(0),
  output_tokens: z.number().int().min(0),
  reasoning_output_tokens: z.number().int().min(0).default(0),
  duration_ms: z.number().int().min(0),
  error_code: z.string().regex(/^[A-Z][A-Z0-9_]{2,63}$/).optional()
})

export const pipelineSystemFailureSchema = z.object({
  failure_code: z.string().regex(/^[A-Z][A-Z0-9_]{2,63}$/),
  failure_message: z.string().trim().min(8).max(1_000)
})

export type PipelineTaskRow = {
  id: string
  task_type:
    | 'expert_research'
    | 'source_discovery'
    | 'source_acquisition'
    | 'source_conversion'
    | 'source_chunking'
    | 'fragment_analysis'
    | 'candidate_verification'
    | 'source_publication'
    | 'source_refresh'
  stage:
    | 'discover'
    | 'acquire'
    | 'convert'
    | 'chunk'
    | 'analyze'
    | 'verify'
    | 'publish'
  payload: Record<string, unknown>
  coverage_target_id: string | null
  source_candidate_id: string | null
  expert_task_id: string | null
  attempts?: number
}

const aiTaskTypes: PipelineTaskRow['task_type'][] = [
  'expert_research',
  'source_discovery',
  'fragment_analysis',
  'candidate_verification',
  'source_refresh'
]

const mechanicalTaskTypes: PipelineTaskRow['task_type'][] = [
  'source_acquisition',
  'source_conversion',
  'source_chunking',
  'source_publication'
]
const maxFragmentAnalysisBatchBytes = 30_000
const maxFragmentAnalysisBatchSize = 8

export function boundFragmentAnalysisBatch<
  T extends { content: string }
>(
  fragments: T[],
  maxBytes = maxFragmentAnalysisBatchBytes,
): T[] {
  const selected: T[] = []
  let selectedBytes = 0
  for (const fragment of fragments) {
    if (selected.length >= maxFragmentAnalysisBatchSize) break
    const fragmentBytes = Buffer.byteLength(fragment.content, 'utf8')
    if (
      selected.length > 0 &&
      selectedBytes + fragmentBytes > maxBytes
    ) {
      break
    }
    selected.push(fragment)
    selectedBytes += fragmentBytes
  }
  return selected
}

async function recordEvent(
  client: DatabaseClient,
  input: {
    taskId?: string | null
    sourceId?: string | null
    stage:
      | PipelineTaskRow['stage']
      | 'system'
    event:
      | 'queued'
      | 'claimed'
      | 'started'
      | 'progress'
      | 'completed'
      | 'failed'
      | 'retried'
      | 'paused'
      | 'resumed'
      | 'skipped'
    message: string
    metadata?: Record<string, unknown>
  },
): Promise<void> {
  await client.query(
    `INSERT INTO pipeline_events (
       pipeline_task_id,
       source_candidate_id,
       stage,
       event_type,
       message,
       metadata
     )
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
    [
      input.taskId ?? null,
      input.sourceId ?? null,
      input.stage,
      input.event,
      input.message,
      JSON.stringify(input.metadata ?? {})
    ],
  )
}

async function insertTask(
  client: DatabaseClient,
  input: {
    type: PipelineTaskRow['task_type']
    stage: PipelineTaskRow['stage']
    priority: number
    dedupeKey: string
    coverageTargetId?: string | null
    sourceId?: string | null
    expertTaskId?: string | null
    payload?: Record<string, unknown>
  },
): Promise<string | null> {
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO pipeline_tasks (
       task_type,
       stage,
       priority,
       coverage_target_id,
       source_candidate_id,
       expert_task_id,
       dedupe_key,
       payload
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
     ON CONFLICT (dedupe_key)
       WHERE status IN ('queued', 'claimed', 'running')
     DO NOTHING
     RETURNING id`,
    [
      input.type,
      input.stage,
      input.priority,
      input.coverageTargetId ?? null,
      input.sourceId ?? null,
      input.expertTaskId ?? null,
      input.dedupeKey,
      JSON.stringify(input.payload ?? {})
    ],
  )
  const taskId = inserted.rows[0]?.id ?? null
  if (taskId) {
    await recordEvent(client, {
      taskId,
      sourceId: input.sourceId ?? null,
      stage: input.stage,
      event: 'queued',
      message: `Queued ${input.type.replaceAll('_', ' ')} work.`
    })
  }
  return taskId
}

async function reconcileExpiredAndCompletedWork(
  client: DatabaseClient,
): Promise<void> {
  const expired = await client.query<{
    id: string
    stage: PipelineTaskRow['stage']
    source_candidate_id: string | null
    attempts: number
  }>(
    `UPDATE pipeline_tasks
        SET status = CASE WHEN attempts >= 5 THEN 'failed' ELSE 'queued' END,
            claim_owner = NULL,
            lease_token_hash = NULL,
            lease_until = NULL,
            heartbeat_at = NULL,
            failure_code = CASE
              WHEN attempts >= 5 THEN 'LEASE_ATTEMPTS_EXHAUSTED'
              ELSE NULL
            END,
            failure_message = CASE
              WHEN attempts >= 5 THEN 'Pipeline task lease expired too many times.'
              ELSE NULL
            END,
            completed_at = CASE WHEN attempts >= 5 THEN now() ELSE NULL END,
            updated_at = now()
      WHERE status IN ('claimed', 'running')
        AND lease_until <= now()
      RETURNING id, stage, source_candidate_id, attempts`,
  )
  for (const task of expired.rows) {
    await recordEvent(client, {
      taskId: task.id,
      sourceId: task.source_candidate_id,
      stage: task.stage,
      event: task.attempts >= 5 ? 'failed' : 'retried',
      message:
        task.attempts >= 5
          ? 'Pipeline lease attempts were exhausted.'
          : 'Expired pipeline lease returned to the queue.'
    })
  }

  await client.query(
    `UPDATE pipeline_tasks pt
        SET status = CASE
              WHEN et.status = 'completed' THEN 'completed'
              ELSE 'failed'
            END,
            result = jsonb_build_object(
              'expert_task_status', et.status,
              'revision_id', et.result_revision_id
            ),
            failure_code = et.failure_code,
            failure_message = et.failure_message,
            completed_at = coalesce(et.completed_at, now()),
            updated_at = now()
       FROM expert_tasks et
      WHERE pt.expert_task_id = et.id
        AND pt.task_type = 'expert_research'
        AND pt.status IN ('queued', 'claimed', 'running')
        AND et.status IN ('completed', 'failed', 'cancelled', 'expired')`,
  )
}

async function queueExpertWork(client: DatabaseClient): Promise<boolean> {
  const expert = await client.query<{
    id: string
    public_id: string
    question: string
    network_context: Record<string, unknown>
  }>(
    `SELECT id, public_id, question, network_context
       FROM expert_tasks
      WHERE status = 'queued'
      ORDER BY priority DESC, created_at
      LIMIT 1
      FOR UPDATE SKIP LOCKED`,
  )
  const task = expert.rows[0]
  if (!task) return false
  const id = await insertTask(client, {
    type: 'expert_research',
    stage: 'analyze',
    priority: 100,
    dedupeKey: `expert:${task.id}`,
    expertTaskId: task.id,
    payload: {
      task_id: task.public_id,
      question: task.question,
      network_context: task.network_context
    }
  })
  return Boolean(id)
}

async function queueSourceWork(
  client: DatabaseClient,
  sourceId: string,
): Promise<boolean> {
  const sourceResult = await client.query<{
    id: string
    status: string
    coverage_target_id: string
    vendor_slug: string
    product_family: string | null
    model: string | null
    operating_system_slug: string
    version_branch: string | null
    document_role: string
    canonical_url: string
    document_type: string
    title: string
    document_version: string | null
    document_date: string | null
  }>(
    `SELECT
       sc.id,
       sc.status,
       sc.coverage_target_id,
       ct.vendor_slug,
       ct.product_family,
       ct.model,
       ct.operating_system_slug,
       ct.version_branch,
       ct.document_role,
       sc.canonical_url,
       sc.document_type,
       sc.title,
       sc.document_version,
       sc.document_date
     FROM source_candidates sc
     JOIN coverage_targets ct ON ct.id = sc.coverage_target_id
     WHERE sc.id = $1
     FOR UPDATE OF sc`,
    [sourceId],
  )
  const source = sourceResult.rows[0]
  if (!source) {
    await client.query(
      `UPDATE pipeline_settings
          SET active_source_id = NULL,
              updated_at = now()
        WHERE singleton`,
    )
    return false
  }

  if (['completed', 'duplicate', 'rejected', 'failed'].includes(source.status)) {
    await client.query(
      `UPDATE pipeline_settings
          SET active_source_id = NULL,
              updated_at = now(),
              updated_by = 'scheduler-terminal-source'
        WHERE singleton AND active_source_id = $1`,
      [source.id],
    )
    return false
  }

  const basePayload = {
    source_id: source.id,
    canonical_url: source.canonical_url,
    document_type: source.document_type,
    title: source.title,
    document_version: source.document_version,
    document_date: source.document_date,
    coverage_target: {
      vendor_slug: source.vendor_slug,
      product_family: source.product_family,
      model: source.model,
      operating_system_slug: source.operating_system_slug,
      version_branch: source.version_branch,
      document_role: source.document_role
    }
  }

  if (['discovered', 'approved', 'acquiring'].includes(source.status)) {
    return Boolean(await insertTask(client, {
      type: 'source_acquisition',
      stage: 'acquire',
      priority: 80,
      dedupeKey: `source:${source.id}:acquire`,
      coverageTargetId: source.coverage_target_id,
      sourceId: source.id,
      payload: basePayload
    }))
  }
  if (['acquired', 'converting'].includes(source.status)) {
    return Boolean(await insertTask(client, {
      type: 'source_conversion',
      stage: 'convert',
      priority: 78,
      dedupeKey: `source:${source.id}:convert`,
      coverageTargetId: source.coverage_target_id,
      sourceId: source.id,
      payload: basePayload
    }))
  }
  if (['converted', 'chunking'].includes(source.status)) {
    return Boolean(await insertTask(client, {
      type: 'source_chunking',
      stage: 'chunk',
      priority: 76,
      dedupeKey: `source:${source.id}:chunk`,
      coverageTargetId: source.coverage_target_id,
      sourceId: source.id,
      payload: basePayload
    }))
  }

  const queuedFragments = await client.query<{
    id: string
    ordinal: number
    section_title: string | null
    source_locator: string | null
    content: string
    content_hash: string
  }>(
    `SELECT
       sf.id,
       sf.ordinal,
       sf.section_title,
       sf.source_locator,
       sf.content,
       sf.content_hash
     FROM source_fragments sf
     JOIN source_artifacts sa ON sa.id = sf.source_artifact_id
     WHERE sa.source_candidate_id = $1
       AND sf.status = 'queued'
     ORDER BY sf.ordinal
     LIMIT 8
     FOR UPDATE OF sf SKIP LOCKED`,
    [source.id],
  )
  const analysisFragments = boundFragmentAnalysisBatch(
    queuedFragments.rows,
  )
  if (analysisFragments.length > 0) {
    const fragmentIds = analysisFragments.map((row) => row.id)
    return Boolean(await insertTask(client, {
      type: 'fragment_analysis',
      stage: 'analyze',
      priority: 70,
      dedupeKey: `source:${source.id}:analyze:${sha256Label(
        fragmentIds.join(','),
      )}`,
      coverageTargetId: source.coverage_target_id,
      sourceId: source.id,
      payload: {
        ...basePayload,
        fragments: analysisFragments
      }
    }))
  }

  const analyzedCandidates = await client.query<{
    id: string
    stable_key: string
    payload: Record<string, unknown>
    dangerous: boolean
    confidence: string
    quality_score: string
  }>(
    `SELECT
       id,
       stable_key,
       payload,
       dangerous,
       confidence,
       quality_score
     FROM knowledge_candidates
     WHERE status = 'analyzed'
       AND pipeline_task_id IN (
         SELECT id FROM pipeline_tasks WHERE source_candidate_id = $1
       )
     ORDER BY created_at
     LIMIT 50
     FOR UPDATE SKIP LOCKED`,
    [source.id],
  )
  if (analyzedCandidates.rows.length > 0) {
    const candidateIds = analyzedCandidates.rows.map((row) => row.id)
    return Boolean(await insertTask(client, {
      type: 'candidate_verification',
      stage: 'verify',
      priority: 72,
      dedupeKey: `source:${source.id}:verify:${sha256Label(
        candidateIds.join(','),
      )}`,
      coverageTargetId: source.coverage_target_id,
      sourceId: source.id,
      payload: {
        ...basePayload,
        candidates: analyzedCandidates.rows
      }
    }))
  }

  const outstanding = await client.query<{ count: number }>(
    `SELECT (
       (SELECT count(*) FROM source_fragments sf
        JOIN source_artifacts sa ON sa.id = sf.source_artifact_id
        WHERE sa.source_candidate_id = $1
          AND sf.status IN ('queued', 'analyzing'))
       +
       (SELECT count(*) FROM knowledge_candidates kc
        JOIN pipeline_tasks pt ON pt.id = kc.pipeline_task_id
        WHERE pt.source_candidate_id = $1
          AND kc.status = 'analyzed')
     )::int AS count`,
    [source.id],
  )
  if ((outstanding.rows[0]?.count ?? 0) === 0) {
    return Boolean(await insertTask(client, {
      type: 'source_publication',
      stage: 'publish',
      priority: 74,
      dedupeKey: `source:${source.id}:publish`,
      coverageTargetId: source.coverage_target_id,
      sourceId: source.id,
      payload: basePayload
    }))
  }
  return false
}

async function queueDiscoveryWork(client: DatabaseClient): Promise<boolean> {
  const targetResult = await client.query<{
    id: string
    vendor_slug: string
    product_family: string | null
    model: string | null
    operating_system_slug: string
    version_branch: string | null
    document_role: string
    priority: number
  }>(
    `SELECT
       id,
       vendor_slug,
       product_family,
       model,
       operating_system_slug,
       version_branch,
       document_role,
       priority
     FROM coverage_targets
     WHERE status <> 'paused'
       AND (
         status IN ('queued', 'failed')
         OR next_check_at <= now()
       )
     ORDER BY priority DESC, next_check_at, updated_at
     LIMIT 1
     FOR UPDATE SKIP LOCKED`,
  )
  const target = targetResult.rows[0]
  if (!target) {
    await client.query(
      `UPDATE coverage_targets
          SET status = 'queued',
              next_check_at = now(),
              updated_at = now()
        WHERE id = (
          SELECT id
          FROM coverage_targets
          WHERE status = 'covered'
          ORDER BY next_check_at, priority DESC
          LIMIT 1
        )`,
    )
    return false
  }

  await client.query(
    `UPDATE coverage_targets
        SET status = 'discovering',
            last_discovered_at = now(),
            updated_at = now()
      WHERE id = $1`,
    [target.id],
  )
  return Boolean(await insertTask(client, {
    type: 'source_discovery',
    stage: 'discover',
    priority: Math.max(10, target.priority),
    dedupeKey: `coverage:${target.id}:discover`,
    coverageTargetId: target.id,
    payload: {
      coverage_target: target,
      requirements: {
        public_https_only: true,
        official_vendor_sources_only: true,
        no_authenticated_sources: true,
        source_urls_are_internal: true
      }
    }
  }))
}

async function ensureWorkInTransaction(
  client: DatabaseClient,
): Promise<void> {
  await reconcileExpiredAndCompletedWork(client)
  const settings = await client.query<{
    enabled: boolean
    active_source_id: string | null
  }>(
    `SELECT enabled, active_source_id
     FROM pipeline_settings
     WHERE singleton
     FOR UPDATE`,
  )
  const pipeline = settings.rows[0]
  if (!pipeline?.enabled) return

  if (await queueExpertWork(client)) return

  const alreadyQueued = await client.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1
       FROM pipeline_tasks
       WHERE status IN ('queued', 'claimed', 'running')
     ) AS exists`,
  )
  if (alreadyQueued.rows[0]?.exists) return

  if (
    pipeline.active_source_id &&
    await queueSourceWork(client, pipeline.active_source_id)
  ) {
    return
  }

  const approvedSource = await client.query<{ id: string }>(
    `SELECT id
     FROM source_candidates
     WHERE status IN (
       'discovered',
       'approved',
       'acquired',
       'converted',
       'chunking',
       'analyzing',
       'verifying',
       'publishing'
     )
     ORDER BY discovered_at
     LIMIT 1
     FOR UPDATE SKIP LOCKED`,
  )
  if (approvedSource.rows[0]) {
    await client.query(
      `UPDATE pipeline_settings
          SET active_source_id = $1,
              updated_at = now(),
              updated_by = 'scheduler'
        WHERE singleton`,
      [approvedSource.rows[0].id],
    )
    if (await queueSourceWork(client, approvedSource.rows[0].id)) return
  }

  if (await queueDiscoveryWork(client)) return

  if (await queueDiscoveryWork(client)) return
  throw new Error('PIPELINE_NO_WORK_INVARIANT')
}

export async function ensurePipelineWork(
  database: Database,
): Promise<void> {
  await withTransaction(database, ensureWorkInTransaction)
}

export async function claimPipelineTask(
  database: Database,
  config: AppConfig,
  researcherId: string,
): Promise<Record<string, unknown>> {
  await ensurePipelineWork(database)
  return withTransaction(database, async (client) => {
    const settings = await client.query<{ enabled: boolean }>(
      `SELECT enabled FROM pipeline_settings WHERE singleton FOR UPDATE`,
    )
    if (!settings.rows[0]?.enabled) {
      return { enabled: false, reason: 'pipeline_paused' }
    }

    const selected = await client.query<PipelineTaskRow>(
      `SELECT
         id,
         task_type,
         stage,
         payload,
         coverage_target_id,
         source_candidate_id,
         expert_task_id
       FROM pipeline_tasks
       WHERE status = 'queued'
         AND task_type = ANY($1::text[])
       ORDER BY priority DESC, created_at
       FOR UPDATE SKIP LOCKED
       LIMIT 1`,
      [aiTaskTypes],
    )
    const task = selected.rows[0]
    if (!task) {
      const activeMechanical = await client.query<{
        task_type: PipelineTaskRow['task_type']
        stage: PipelineTaskRow['stage']
        status: string
      }>(
        `SELECT task_type, stage, status
         FROM pipeline_tasks
         WHERE status IN ('queued', 'claimed', 'running')
         ORDER BY priority DESC, created_at
         LIMIT 1`,
      )
      if (!activeMechanical.rows[0]) {
        throw new Error('PIPELINE_NO_WORK_INVARIANT')
      }
      await client.query(
        `INSERT INTO worker_heartbeats (
           worker_name, instance_id, heartbeat_at, metadata
         )
         VALUES (
           'pipeline-coordinator',
           $1,
           now(),
           jsonb_build_object(
             'status', 'deterministic_work_in_progress',
             'stage', $2::text,
             'task_type', $3::text
           )
         )
         ON CONFLICT (worker_name)
         DO UPDATE SET
           instance_id = excluded.instance_id,
           heartbeat_at = excluded.heartbeat_at,
           metadata = excluded.metadata`,
        [
          researcherId,
          activeMechanical.rows[0].stage,
          activeMechanical.rows[0].task_type
        ],
      )
      return {
        enabled: true,
        pipeline_state: 'pipeline_work_in_progress',
        active_task_type: activeMechanical.rows[0].task_type,
        active_stage: activeMechanical.rows[0].stage
      }
    }

    const leaseToken = randomUrlToken()
    const leaseUntil = new Date(
      Date.now() + config.taskLeaseSeconds * 1_000,
    )
    await client.query(
      `UPDATE pipeline_tasks
          SET status = 'running',
              claim_owner = $2,
              lease_token_hash = $3,
              lease_until = $4,
              heartbeat_at = now(),
              attempts = attempts + 1,
              updated_at = now()
        WHERE id = $1`,
      [
        task.id,
        researcherId,
        sha256(leaseToken),
        leaseUntil.toISOString()
      ],
    )
    const run = await client.query<{ id: string }>(
      `INSERT INTO agent_runs (
         pipeline_task_id,
         model,
         reasoning_effort,
         status
       )
       SELECT $1, ai_model, reasoning_effort, 'running'
       FROM pipeline_settings
       WHERE singleton
       RETURNING id`,
      [task.id],
    )
    await client.query(
      `INSERT INTO worker_heartbeats (
         worker_name, instance_id, heartbeat_at, metadata
       )
       VALUES (
         'pipeline-coordinator',
         $1,
         now(),
         jsonb_build_object(
           'status', 'running',
           'model', (
             SELECT ai_model FROM pipeline_settings WHERE singleton
           )
         )
       )
       ON CONFLICT (worker_name)
       DO UPDATE SET
         instance_id = excluded.instance_id,
         heartbeat_at = excluded.heartbeat_at,
         metadata = excluded.metadata`,
      [researcherId],
    )

    let payload = task.payload
    if (task.task_type === 'expert_research' && task.expert_task_id) {
      const expert = await client.query<{
        public_id: string
        question: string
        network_context: Record<string, unknown>
      }>(
        `UPDATE expert_tasks
            SET status = 'researching',
                claim_owner = $2,
                lease_token_hash = $3,
                lease_until = $4,
                heartbeat_at = now(),
                attempts = attempts + 1,
                updated_at = now()
          WHERE id = $1
            AND status = 'queued'
          RETURNING public_id, question, network_context`,
        [
          task.expert_task_id,
          researcherId,
          sha256(leaseToken),
          leaseUntil.toISOString()
        ],
      )
      if (!expert.rows[0]) throw new Error('EXPERT_TASK_NOT_AVAILABLE')
      payload = {
        ...payload,
        task_id: expert.rows[0].public_id,
        question: expert.rows[0].question,
        network_context: expert.rows[0].network_context
      }
    }

    if (task.task_type === 'fragment_analysis') {
      const fragmentIds = (
        Array.isArray(payload['fragments'])
          ? payload['fragments']
          : []
      ).flatMap((fragment) =>
        fragment &&
        typeof fragment === 'object' &&
        'id' in fragment &&
        typeof fragment.id === 'string'
          ? [fragment.id]
          : [],
      )
      if (fragmentIds.length > 0) {
        await client.query(
          `UPDATE source_fragments
              SET status = 'analyzing',
                  attempts = attempts + 1,
                  updated_at = now()
            WHERE id = ANY($1::uuid[])
              AND status = 'queued'`,
          [fragmentIds],
        )
      }
    }

    await recordEvent(client, {
      taskId: task.id,
      sourceId: task.source_candidate_id,
      stage: task.stage,
      event: 'claimed',
      message: `${researcherId} claimed useful ${task.stage} work.`
    })
    return {
      enabled: true,
      pipeline_task_id: task.id,
      task_type: task.task_type,
      stage: task.stage,
      lease_token: leaseToken,
      lease_until: leaseUntil.toISOString(),
      agent_run_id: run.rows[0]!.id,
      payload
    }
  })
}

export async function claimMechanicalPipelineTask(
  database: Database,
  config: AppConfig,
  workerId: string,
): Promise<{
  task: PipelineTaskRow
  leaseToken: string
} | null> {
  await ensurePipelineWork(database)
  return withTransaction(database, async (client) => {
    const settings = await client.query<{ enabled: boolean }>(
      `SELECT enabled FROM pipeline_settings WHERE singleton FOR UPDATE`,
    )
    if (!settings.rows[0]?.enabled) return null

    const selected = await client.query<PipelineTaskRow>(
      `SELECT
         id,
         task_type,
         stage,
         payload,
         coverage_target_id,
         source_candidate_id,
         expert_task_id
       FROM pipeline_tasks
       WHERE status = 'queued'
         AND task_type = ANY($1::text[])
       ORDER BY priority DESC, created_at
       FOR UPDATE SKIP LOCKED
       LIMIT 1`,
      [mechanicalTaskTypes],
    )
    const task = selected.rows[0]
    if (!task) return null

    const leaseToken = randomUrlToken()
    const leaseUntil = new Date(
      Date.now() + config.taskLeaseSeconds * 1_000,
    )
    await client.query(
      `UPDATE pipeline_tasks
          SET status = 'running',
              claim_owner = $2,
              lease_token_hash = $3,
              lease_until = $4,
              heartbeat_at = now(),
              attempts = attempts + 1,
              updated_at = now()
        WHERE id = $1`,
      [
        task.id,
        workerId,
        sha256(leaseToken),
        leaseUntil.toISOString()
      ],
    )
    if (task.source_candidate_id) {
      const sourceStatuses: Partial<
        Record<PipelineTaskRow['task_type'], string>
      > = {
        source_acquisition: 'acquiring',
        source_conversion: 'converting',
        source_chunking: 'chunking',
        source_publication: 'publishing'
      }
      const sourceStatus = sourceStatuses[task.task_type]
      if (sourceStatus) {
        await client.query(
          `UPDATE source_candidates
              SET status = $2,
                  updated_at = now()
            WHERE id = $1`,
          [task.source_candidate_id, sourceStatus],
        )
      }
    }
    await recordEvent(client, {
      taskId: task.id,
      sourceId: task.source_candidate_id,
      stage: task.stage,
      event: 'started',
      message: `${workerId} started deterministic ${task.stage} work.`
    })
    return { task, leaseToken }
  })
}

export async function completeMechanicalPipelineTask(
  database: Database,
  taskId: string,
  leaseToken: string,
  result: Record<string, unknown>,
): Promise<void> {
  await withTransaction(database, async (client) => {
    const task = await assertPipelineLease(client, taskId, leaseToken)
    if (!mechanicalTaskTypes.includes(task.task_type)) {
      throw new Error('PIPELINE_TASK_TYPE_INVALID')
    }
    await completeTask(client, task, result)
  })
  await ensurePipelineWork(database)
}

export async function getPipelineTaskStatus(
  database: Database,
  taskId: string,
): Promise<Record<string, unknown>> {
  const result = await database.query<{
    id: string
    task_type: PipelineTaskRow['task_type']
    status: string
    result: Record<string, unknown> | null
    failure_code: string | null
    expert_status: string | null
    expert_artifact_count: number
  }>(
    `SELECT
       pt.id,
       pt.task_type,
       pt.status,
       pt.result,
       pt.failure_code,
       et.status AS expert_status,
       coalesce((
         SELECT count(*)::int
         FROM task_artifacts ta
         WHERE ta.task_id = pt.expert_task_id
           AND ta.artifact_type = 'candidate_revision'
       ), 0)::int AS expert_artifact_count
     FROM pipeline_tasks pt
     LEFT JOIN expert_tasks et ON et.id = pt.expert_task_id
     WHERE pt.id = $1`,
    [taskId],
  )
  const task = result.rows[0]
  if (!task) throw new Error('PIPELINE_TASK_NOT_FOUND')
  const artifactRecorded =
    ['completed', 'failed', 'cancelled', 'skipped'].includes(task.status) ||
    (
      task.task_type === 'expert_research' &&
      task.expert_artifact_count > 0 &&
      ['validating', 'completed'].includes(task.expert_status ?? '')
    )
  return {
    pipeline_task_id: task.id,
    task_type: task.task_type,
    status: task.status,
    artifact_recorded: artifactRecorded,
    result: task.result,
    failure_code: task.failure_code,
    expert_status: task.expert_status
  }
}

export async function recordAgentRunResult(
  database: Database,
  input: z.infer<typeof agentRunResultSchema>,
): Promise<Record<string, unknown>> {
  const result = await database.query<{ id: string }>(
    `UPDATE agent_runs
        SET status = $2,
            input_tokens = $3,
            cached_input_tokens = $4,
            output_tokens = $5,
            reasoning_output_tokens = $6,
            duration_ms = $7,
            error_code = $8,
            published_revisions = coalesce((
              SELECT (pt.result->>'revisions_published')::int
              FROM pipeline_tasks pt
              WHERE pt.id = agent_runs.pipeline_task_id
            ), 0),
            completed_at = now()
      WHERE id = $1
        AND status = 'running'
      RETURNING id`,
    [
      input.agent_run_id,
      input.status,
      input.input_tokens,
      input.cached_input_tokens,
      input.output_tokens,
      input.reasoning_output_tokens,
      input.duration_ms,
      input.error_code ?? null
    ],
  )
  if (!result.rows[0]) throw new Error('AGENT_RUN_NOT_RUNNING')
  return {
    agent_run_id: result.rows[0].id,
    status: input.status,
    tokens:
      input.input_tokens +
      input.output_tokens +
      input.reasoning_output_tokens
  }
}

export async function pausePipelineForSystemFailure(
  database: Database,
  input: z.infer<typeof pipelineSystemFailureSchema>,
  researcherId: string,
): Promise<Record<string, unknown>> {
  return withTransaction(database, async (client) => {
    await client.query(
      `UPDATE pipeline_settings
          SET enabled = false,
              paused_reason = $1,
              updated_at = now(),
              updated_by = $2
        WHERE singleton`,
      [
        `${input.failure_code}: ${input.failure_message}`,
        researcherId
      ],
    )
    await client.query(
      `INSERT INTO pipeline_events (
         stage, event_type, message, metadata
       )
       VALUES (
         'system',
         'paused',
         $1,
         jsonb_build_object('failure_code', $2)
       )`,
      [input.failure_message, input.failure_code],
    )
    await client.query(
      `INSERT INTO worker_heartbeats (
         worker_name, instance_id, heartbeat_at, metadata
       )
       VALUES (
         'pipeline-coordinator',
         $1,
         now(),
         jsonb_build_object(
           'status', 'failed',
           'failure_code', $2
         )
       )
       ON CONFLICT (worker_name)
       DO UPDATE SET
         instance_id = excluded.instance_id,
         heartbeat_at = excluded.heartbeat_at,
         metadata = excluded.metadata`,
      [researcherId, input.failure_code],
    )
    return {
      enabled: false,
      paused_reason: input.failure_code,
      system_failure: true
    }
  })
}

async function assertPipelineLease(
  client: DatabaseClient,
  taskId: string,
  leaseToken: string,
): Promise<PipelineTaskRow> {
  const task = await client.query<PipelineTaskRow>(
    `SELECT
       id,
       task_type,
       stage,
       payload,
       coverage_target_id,
       source_candidate_id,
       expert_task_id,
       attempts
     FROM pipeline_tasks
     WHERE id = $1
       AND status = 'running'
       AND lease_until > now()
       AND lease_token_hash = $2
     FOR UPDATE`,
    [taskId, sha256(leaseToken)],
  )
  if (!task.rows[0]) throw new Error('PIPELINE_LEASE_INVALID')
  return task.rows[0]
}

export async function heartbeatPipelineTask(
  database: Database,
  config: AppConfig,
  taskId: string,
  leaseToken: string,
): Promise<Record<string, unknown>> {
  return withTransaction(database, async (client) => {
    const task = await assertPipelineLease(client, taskId, leaseToken)
    const leaseUntil = new Date(
      Date.now() + config.taskLeaseSeconds * 1_000,
    )
    await client.query(
      `UPDATE pipeline_tasks
          SET heartbeat_at = now(),
              lease_until = $3,
              updated_at = now()
        WHERE id = $1
          AND lease_token_hash = $2`,
      [taskId, sha256(leaseToken), leaseUntil.toISOString()],
    )
    if (task.expert_task_id) {
      await client.query(
        `UPDATE expert_tasks
            SET heartbeat_at = now(),
                lease_until = $3,
                updated_at = now()
          WHERE id = $1
            AND lease_token_hash = $2`,
        [
          task.expert_task_id,
          sha256(leaseToken),
          leaseUntil.toISOString()
        ],
      )
    }
    return {
      pipeline_task_id: taskId,
      status: 'running',
      lease_until: leaseUntil.toISOString()
    }
  })
}

async function completeTask(
  client: DatabaseClient,
  task: PipelineTaskRow,
  result: Record<string, unknown>,
): Promise<void> {
  await client.query(
    `UPDATE pipeline_tasks
        SET status = 'completed',
            result = $2::jsonb,
            failure_code = NULL,
            failure_message = NULL,
            claim_owner = NULL,
            lease_token_hash = NULL,
            lease_until = NULL,
            completed_at = now(),
            updated_at = now()
      WHERE id = $1`,
    [task.id, JSON.stringify(result)],
  )
  await recordEvent(client, {
    taskId: task.id,
    sourceId: task.source_candidate_id,
    stage: task.stage,
    event: 'completed',
    message: `Completed ${task.task_type.replaceAll('_', ' ')} work.`,
    metadata: result
  })
}

export async function submitSourceDiscovery(
  database: Database,
  input: z.infer<typeof discoverySubmissionSchema>,
  researcherId: string,
): Promise<Record<string, unknown>> {
  const safeSources: z.infer<typeof discoverySourceSchema>[] = []
  for (const source of input.sources) {
    await assertSafeProvenanceUrl(source.canonical_url)
    safeSources.push(source)
  }
  const result = await withTransaction(database, async (client) => {
    const task = await assertPipelineLease(
      client,
      input.pipeline_task_id,
      input.lease_token,
    )
    if (
      !['source_discovery', 'source_refresh'].includes(task.task_type) ||
      !task.coverage_target_id
    ) {
      throw new Error('PIPELINE_TASK_TYPE_INVALID')
    }
    const insertedIds: string[] = []
    let duplicates = 0
    for (const source of safeSources) {
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO source_candidates (
           coverage_target_id,
           canonical_url,
           document_type,
           title,
           document_version,
           document_date,
           status,
           discovered_by,
           discovery_pipeline_task_id
         )
         VALUES ($1, $2, $3, $4, $5, $6, 'approved', $7, $8)
         ON CONFLICT (canonical_url) DO NOTHING
         RETURNING id`,
        [
          task.coverage_target_id,
          source.canonical_url,
          source.document_type,
          source.title,
          source.document_version ?? null,
          source.document_date ?? null,
          researcherId,
          task.id
        ],
      )
      if (inserted.rows[0]) insertedIds.push(inserted.rows[0].id)
      else duplicates += 1
    }
    await client.query(
      `UPDATE coverage_targets
          SET status = CASE WHEN $2 > 0 THEN 'active' ELSE 'covered' END,
              coverage_percent = CASE
                WHEN $2 > 0 THEN greatest(coverage_percent, 5)
                ELSE coverage_percent
              END,
              next_check_at = now() + CASE
                WHEN $2 > 0 THEN interval '30 days'
                ELSE interval '7 days'
              END,
              updated_at = now()
        WHERE id = $1`,
      [task.coverage_target_id, insertedIds.length],
    )
    if (insertedIds[0]) {
      await client.query(
        `UPDATE pipeline_settings
            SET active_source_id = $1,
                updated_at = now(),
                updated_by = $2
          WHERE singleton`,
        [insertedIds[0], researcherId],
      )
    }
    const completion = {
      inserted_sources: insertedIds.length,
      duplicate_sources: duplicates,
      active_source_id: insertedIds[0] ?? null,
      rejection_reason: input.rejection_reason ?? null
    }
    await completeTask(client, task, completion)
    return completion
  })
  await ensurePipelineWork(database)
  return result
}

export async function submitCandidateAnalysis(
  database: Database,
  input: z.infer<typeof candidateAnalysisSubmissionSchema>,
): Promise<Record<string, unknown>> {
  const result = await withTransaction(database, async (client) => {
    const task = await assertPipelineLease(
      client,
      input.pipeline_task_id,
      input.lease_token,
    )
    if (task.task_type !== 'fragment_analysis') {
      throw new Error('PIPELINE_TASK_TYPE_INVALID')
    }
    const allowedFragmentIds = new Set(
      (
        Array.isArray(task.payload['fragments'])
          ? task.payload['fragments']
          : []
      ).flatMap((fragment) =>
        fragment &&
        typeof fragment === 'object' &&
        'id' in fragment &&
        typeof fragment.id === 'string'
          ? [fragment.id]
          : [],
      ),
    )
    const insertedIds: string[] = []
    for (const submission of input.candidates) {
      if (!allowedFragmentIds.has(submission.fragment_id)) {
        throw new Error('PIPELINE_FRAGMENT_NOT_IN_TASK')
      }
      const candidate = enforceKnowledgeRisk(
        pipelineCandidatePayloadSchema.parse(submission.candidate),
      )
      const serialized = JSON.stringify(candidate)
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO knowledge_candidates (
           pipeline_task_id,
           source_fragment_id,
           stable_key,
           payload,
           content_hash,
           dangerous,
           confidence,
           quality_score
         )
         VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8)
         ON CONFLICT (content_hash) DO NOTHING
         RETURNING id`,
        [
          task.id,
          submission.fragment_id,
          candidate.stable_key,
          serialized,
          sha256Label(serialized),
          candidate.dangerous,
          candidate.confidence,
          candidate.quality_score
        ],
      )
      if (inserted.rows[0]) insertedIds.push(inserted.rows[0].id)
    }
    const submittedFragmentIds = [
      ...new Set(input.candidates.map((entry) => entry.fragment_id))
    ]
    const rejectedFragmentIds = [
      ...new Set(input.rejected_fragments.map((entry) => entry.fragment_id))
    ]
    for (const fragmentId of rejectedFragmentIds) {
      if (!allowedFragmentIds.has(fragmentId)) {
        throw new Error('PIPELINE_FRAGMENT_NOT_IN_TASK')
      }
    }
    const handledFragmentIds = new Set([
      ...submittedFragmentIds,
      ...rejectedFragmentIds
    ])
    if (
      handledFragmentIds.size !== allowedFragmentIds.size ||
      [...allowedFragmentIds].some((id) => !handledFragmentIds.has(id))
    ) {
      throw new Error('PIPELINE_ANALYSIS_INCOMPLETE')
    }
    await client.query(
      `UPDATE source_fragments
          SET status = 'analyzed',
              updated_at = now()
        WHERE id = ANY($1::uuid[])`,
      [submittedFragmentIds],
    )
    if (rejectedFragmentIds.length > 0) {
      await client.query(
        `UPDATE source_fragments
            SET status = 'rejected',
                updated_at = now()
          WHERE id = ANY($1::uuid[])`,
        [rejectedFragmentIds],
      )
    }
    const completion = {
      candidates_created: insertedIds.length,
      fragments_analyzed: submittedFragmentIds.length,
      fragments_without_candidates: rejectedFragmentIds.length,
      rejection_reasons: input.rejected_fragments.map((entry) => ({
        fragment_id: entry.fragment_id,
        reason: entry.reason
      }))
    }
    await completeTask(client, task, completion)
    return completion
  })
  await ensurePipelineWork(database)
  return result
}

async function getDeterministicCandidateDisposition(
  client: DatabaseClient,
  unparsedCandidate: unknown,
): Promise<{
  decision: 'conflict' | 'manual_review'
  finding: string
} | null> {
  const candidate = pipelineCandidatePayloadSchema.parse(unparsedCandidate)

  try {
    if (candidate.version_min) normalizeVendorVersion(candidate.version_min)
    if (candidate.version_max) normalizeVendorVersion(candidate.version_max)
  } catch {
    return {
      decision: 'manual_review',
      finding:
        'Deterministic version validation could not normalize the declared scope.'
    }
  }

  const context = await client.query<{
    vendor_exists: boolean
    operating_system_exists: boolean
    platform_exists: boolean
    existing_kind: string | null
  }>(
    `SELECT
       EXISTS (
         SELECT 1 FROM vendors v
         WHERE v.slug = $1
       ) AS vendor_exists,
       EXISTS (
         SELECT 1
         FROM operating_systems os
         JOIN vendors v ON v.id = os.vendor_id
         WHERE v.slug = $1 AND os.slug = $2
       ) AS operating_system_exists,
       (
         $3::text IS NULL OR EXISTS (
           SELECT 1
           FROM platforms p
           JOIN vendors v ON v.id = p.vendor_id
           WHERE v.slug = $1 AND p.slug = $3
         )
       ) AS platform_exists,
       (
         SELECT ki.kind
         FROM knowledge_items ki
         WHERE ki.stable_key = $4
       ) AS existing_kind`,
    [
      candidate.vendor_slug,
      candidate.operating_system_slug,
      candidate.platform_slug ?? null,
      candidate.stable_key
    ],
  )
  const state = context.rows[0]
  if (!state?.vendor_exists) {
    return {
      decision: 'manual_review',
      finding:
        'Deterministic context validation could not resolve the declared vendor.'
    }
  }
  if (!state.operating_system_exists) {
    return {
      decision: 'manual_review',
      finding:
        'Deterministic context validation could not resolve the declared operating system.'
    }
  }
  if (!state.platform_exists) {
    return {
      decision: 'manual_review',
      finding:
        'Deterministic context validation could not resolve the declared platform.'
    }
  }
  if (state.existing_kind && state.existing_kind !== candidate.kind) {
    return {
      decision: 'conflict',
      finding:
        'The stable key already exists with a different knowledge kind.'
    }
  }
  return null
}

export async function submitCandidateVerification(
  database: Database,
  config: AppConfig,
  input: z.infer<typeof candidateVerificationSubmissionSchema>,
  researcherId: string,
): Promise<Record<string, unknown>> {
  const result = await withTransaction(database, async (client) => {
    const task = await assertPipelineLease(
      client,
      input.pipeline_task_id,
      input.lease_token,
    )
    if (task.task_type !== 'candidate_verification') {
      throw new Error('PIPELINE_TASK_TYPE_INVALID')
    }
    const allowedCandidateIds = new Set(
      (
        Array.isArray(task.payload['candidates'])
          ? task.payload['candidates']
          : []
      ).flatMap((candidate) =>
        candidate &&
        typeof candidate === 'object' &&
        'id' in candidate &&
        typeof candidate.id === 'string'
          ? [candidate.id]
          : [],
      ),
    )
    const counts = {
      verified: 0,
      rejected: 0,
      conflict: 0,
      manual_review: 0
    }
    for (const decision of input.decisions) {
      if (!allowedCandidateIds.has(decision.candidate_id)) {
        throw new Error('PIPELINE_CANDIDATE_NOT_IN_TASK')
      }
      const candidate = await client.query<{
        dangerous: boolean
        payload: unknown
      }>(
        `SELECT dangerous, payload
         FROM knowledge_candidates
         WHERE id = $1
         FOR UPDATE`,
        [decision.candidate_id],
      )
      if (!candidate.rows[0]) throw new Error('PIPELINE_CANDIDATE_NOT_FOUND')
      const threshold = candidate.rows[0].dangerous
        ? config.dangerousAutoPublishConfidence
        : config.autoPublishConfidence
      const deterministicDisposition =
        decision.decision === 'verified'
          ? await getDeterministicCandidateDisposition(
              client,
              candidate.rows[0].payload,
            )
          : null
      const finalDecision = deterministicDisposition?.decision ?? (
        decision.decision === 'verified' &&
        (
          decision.confidence < threshold ||
          decision.quality_score < 0.85
        )
          ? 'manual_review'
          : decision.decision
      )
      counts[finalDecision] += 1
      await client.query(
        `INSERT INTO candidate_verifications (
           knowledge_candidate_id,
           pipeline_task_id,
           decision,
           confidence,
           quality_score,
           findings,
           verified_by
         )
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)`,
        [
          decision.candidate_id,
          task.id,
          finalDecision,
          decision.confidence,
          decision.quality_score,
          JSON.stringify([
            ...decision.findings,
            ...(
              deterministicDisposition
                ? [deterministicDisposition.finding]
                : []
            )
          ]),
          researcherId
        ],
      )
      await client.query(
        `UPDATE knowledge_candidates
            SET status = $2,
                confidence = $3,
                quality_score = $4,
                updated_at = now()
          WHERE id = $1`,
        [
          decision.candidate_id,
          finalDecision,
          decision.confidence,
          decision.quality_score
        ],
      )
    }
    const omitted = [...allowedCandidateIds].filter(
      (id) => !input.decisions.some((entry) => entry.candidate_id === id),
    )
    if (omitted.length > 0) {
      await client.query(
        `UPDATE knowledge_candidates
            SET status = 'manual_review',
                updated_at = now()
          WHERE id = ANY($1::uuid[])`,
        [omitted],
      )
      counts.manual_review += omitted.length
    }
    await client.query(
      `UPDATE source_fragments sf
          SET status = 'verified',
              updated_at = now()
        WHERE sf.id IN (
          SELECT DISTINCT kc.source_fragment_id
          FROM knowledge_candidates kc
          WHERE kc.id = ANY($1::uuid[])
            AND kc.source_fragment_id IS NOT NULL
            AND kc.status = 'verified'
        )
          AND NOT EXISTS (
            SELECT 1
            FROM knowledge_candidates outstanding
            WHERE outstanding.source_fragment_id = sf.id
              AND outstanding.status = 'analyzed'
          )`,
      [[...allowedCandidateIds]],
    )
    await completeTask(client, task, counts)
    return counts
  })
  await ensurePipelineWork(database)
  return result
}

export async function failPipelineTask(
  database: Database,
  input: z.infer<typeof pipelineFailureSchema>,
): Promise<Record<string, unknown>> {
  const result = await withTransaction(database, async (client) => {
    const task = await assertPipelineLease(
      client,
      input.pipeline_task_id,
      input.lease_token,
    )
    const terminalFailureCodes = new Set([
      'EXPERT_NO_VERIFIED_ANSWER',
      'PIPELINE_EXPLICIT_REJECTION',
      'SOURCE_POLICY_REJECTED'
    ])
    const retrying =
      (task.attempts ?? 1) < 5 &&
      !terminalFailureCodes.has(input.failure_code)
    await client.query(
      `UPDATE pipeline_tasks
          SET status = $4,
              failure_code = $2,
              failure_message = $3,
              claim_owner = NULL,
              lease_token_hash = NULL,
              lease_until = NULL,
              heartbeat_at = NULL,
              completed_at = CASE
                WHEN $4 = 'failed' THEN now()
                ELSE NULL
              END,
              updated_at = now()
        WHERE id = $1`,
      [
        task.id,
        input.failure_code,
        input.failure_message,
        retrying ? 'queued' : 'failed'
      ],
    )
    if (task.expert_task_id) {
      await client.query(
        `UPDATE expert_tasks
            SET status = $4,
                failure_code = $2,
                failure_message = $3,
                claim_owner = NULL,
                lease_token_hash = NULL,
                lease_until = NULL,
                heartbeat_at = NULL,
                completed_at = CASE
                  WHEN $4 = 'failed' THEN now()
                  ELSE NULL
                END,
                updated_at = now()
          WHERE id = $1
            AND status IN ('claimed', 'researching')`,
        [
          task.expert_task_id,
          input.failure_code,
          input.failure_message,
          retrying ? 'queued' : 'failed'
        ],
      )
    }
    if (task.source_candidate_id) {
      if (retrying) {
        const retrySourceStatus: Partial<
          Record<PipelineTaskRow['task_type'], string>
        > = {
          source_acquisition: 'approved',
          source_conversion: 'acquired',
          source_chunking: 'converted',
          fragment_analysis: 'analyzing',
          candidate_verification: 'verifying',
          source_publication: 'publishing',
          source_refresh: 'approved'
        }
        await client.query(
          `UPDATE source_candidates
              SET status = $2,
                  failure_code = $3,
                  failure_message = $4,
                  updated_at = now()
            WHERE id = $1`,
          [
            task.source_candidate_id,
            retrySourceStatus[task.task_type] ?? 'approved',
            input.failure_code,
            input.failure_message
          ],
        )
        if (task.task_type === 'fragment_analysis') {
          const fragmentIds = (
            Array.isArray(task.payload['fragments'])
              ? task.payload['fragments']
              : []
          ).flatMap((fragment) =>
            fragment &&
            typeof fragment === 'object' &&
            'id' in fragment &&
            typeof fragment.id === 'string'
              ? [fragment.id]
              : [],
          )
          if (fragmentIds.length > 0) {
            await client.query(
              `UPDATE source_fragments
                  SET status = 'queued',
                      updated_at = now()
                WHERE id = ANY($1::uuid[])
                  AND status = 'analyzing'`,
              [fragmentIds],
            )
          }
        }
      } else {
        await client.query(
          `UPDATE source_candidates
              SET status = 'failed',
                  failure_code = $2,
                  failure_message = $3,
                  updated_at = now()
            WHERE id = $1`,
          [
            task.source_candidate_id,
            input.failure_code,
            input.failure_message
          ],
        )
        await client.query(
          `UPDATE pipeline_settings
              SET active_source_id = NULL,
                  updated_at = now(),
                  updated_by = 'pipeline-failure'
            WHERE singleton
              AND active_source_id = $1`,
          [task.source_candidate_id],
        )
      }
    }
    if (!retrying && task.coverage_target_id) {
      await client.query(
        `UPDATE coverage_targets
            SET status = 'failed',
                next_check_at = now(),
                updated_at = now()
          WHERE id = $1`,
        [task.coverage_target_id],
      )
    }
    await recordEvent(client, {
      taskId: task.id,
      sourceId: task.source_candidate_id,
      stage: task.stage,
      event: retrying ? 'retried' : 'failed',
      message: retrying
        ? `Stage returned to the queue: ${input.failure_message}`
        : input.failure_message,
      metadata: { failure_code: input.failure_code }
    })
    return {
      pipeline_task_id: task.id,
      status: retrying ? 'queued' : 'failed',
      retrying,
      failure_code: input.failure_code
    }
  })
  await ensurePipelineWork(database)
  return result
}
