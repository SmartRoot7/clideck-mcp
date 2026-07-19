import {
  enforceCoreCandidatePolicy
} from '@clideck/domain-kit'

import type { AppConfig } from '../config.js'
import { sha256Label } from '../crypto.js'
import type { Database, DatabaseClient } from '../db.js'
import { withTransaction } from '../db.js'
import type { Logger } from '../logger.js'
import { normalizeVendorVersion } from '../version.js'
import { candidateRevisionSchema } from './schemas.js'
import { getNetworkDomainPack } from './domain-packs.js'
import { enforceKnowledgeRisk } from './risk.js'

const storedCandidateSchema = candidateRevisionSchema.omit({
  lease_token: true
})
export const candidateKnowledgeSchema = candidateRevisionSchema.omit({
  task_id: true,
  lease_token: true
})
export type CandidateKnowledge = ReturnType<
  typeof candidateKnowledgeSchema.parse
>

type CandidateTaskRow = {
  id: string
  public_id: string
  artifact_id: string
  payload: unknown
}

function scopedResearcherStableKey(candidate: CandidateKnowledge): string {
  const scopeHash = sha256Label([
    candidate.kind,
    candidate.vendor_slug,
    candidate.platform_slug ?? 'all-platforms',
    candidate.operating_system_slug,
    candidate.version_min ?? 'unbounded-minimum',
    candidate.version_max ?? 'unbounded-maximum'
  ].join('\0')).slice('sha256:'.length, 'sha256:'.length + 12)
  const suffix = `.scope-${scopeHash}`
  const prefix = candidate.stable_key
    .slice(0, 160 - suffix.length)
    .replace(/[._-]+$/, '')
  return `${prefix}${suffix}`
}

async function resolveCandidateStableKey(
  client: DatabaseClient,
  candidate: CandidateKnowledge,
  createdBy: 'researcher' | 'legacy_import' | 'super_admin',
): Promise<string> {
  if (createdBy !== 'researcher') return candidate.stable_key

  const collision = await client.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM knowledge_items WHERE stable_key = $1
     ) AS exists`,
    [candidate.stable_key],
  )
  return collision.rows[0]?.exists
    ? scopedResearcherStableKey(candidate)
    : candidate.stable_key
}

async function resolveCandidateContext(
  client: DatabaseClient,
  candidate: CandidateKnowledge,
) {
  const vendor = await client.query<{ id: string }>(
    'SELECT id FROM vendors WHERE slug = $1',
    [candidate.vendor_slug],
  )
  if (!vendor.rows[0]) throw new Error('CANDIDATE_VENDOR_UNKNOWN')

  const operatingSystem = await client.query<{ id: string }>(
    `SELECT id
     FROM operating_systems
     WHERE vendor_id = $1 AND slug = $2`,
    [vendor.rows[0].id, candidate.operating_system_slug],
  )
  if (!operatingSystem.rows[0]) throw new Error('CANDIDATE_OS_UNKNOWN')

  let platformId: string | null = null
  if (candidate.platform_slug) {
    const platform = await client.query<{ id: string }>(
      `SELECT id
       FROM platforms
       WHERE vendor_id = $1 AND slug = $2`,
      [vendor.rows[0].id, candidate.platform_slug],
    )
    if (!platform.rows[0]) throw new Error('CANDIDATE_PLATFORM_UNKNOWN')
    platformId = platform.rows[0].id
  }

  return {
    vendorId: vendor.rows[0].id,
    operatingSystemId: operatingSystem.rows[0].id,
    platformId
  }
}

export async function createKnowledgeRevision(
  client: DatabaseClient,
  unparsedCandidate: unknown,
  createdBy: 'researcher' | 'legacy_import' | 'super_admin' = 'researcher',
): Promise<{ itemId: string; revisionId: string }> {
  const candidate = enforceKnowledgeRisk(
    candidateKnowledgeSchema.parse(unparsedCandidate),
  )
  const networkDomainPack = getNetworkDomainPack()
  const packCandidate = networkDomainPack.candidateSchema.parse(candidate)
  const packValidation = networkDomainPack.validateCandidate(packCandidate)
  if (!packValidation.valid) {
    throw new Error(
      `NETWORK_DOMAIN_CANDIDATE_INVALID:${packValidation.issues
        .map((issue) => issue.code)
        .join(',')}`,
    )
  }
  const coreCandidate = enforceCoreCandidatePolicy(
    networkDomainPack.toCoreCandidate(packCandidate),
  )
  const context = await resolveCandidateContext(client, candidate)
  const stableKey = await resolveCandidateStableKey(
    client,
    candidate,
    createdBy,
  )
  const item = await client.query<{ id: string; kind: string }>(
    `INSERT INTO knowledge_items (domain_id, stable_key, kind)
     VALUES ('network', $1, $2)
     ON CONFLICT (stable_key) DO NOTHING
     RETURNING id, kind`,
    [stableKey, candidate.kind],
  )
  const existingItem = item.rows[0] ?? (
    await client.query<{ id: string; kind: string }>(
      `SELECT id, kind
       FROM knowledge_items
       WHERE domain_id = 'network' AND stable_key = $1`,
      [stableKey],
    )
  ).rows[0]
  if (!existingItem || existingItem.kind !== candidate.kind) {
    throw new Error('CANDIDATE_STABLE_KEY_KIND_CONFLICT')
  }

  const nextRevision = await client.query<{ next_revision: number }>(
    `SELECT coalesce(max(revision_number), 0)::int + 1 AS next_revision
     FROM knowledge_revisions
     WHERE knowledge_item_id = $1`,
    [existingItem.id],
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
       vendor_id,
       platform_id,
       operating_system_id,
       version_min,
       version_max,
       version_normalized_min,
       version_normalized_max,
       title,
       summary,
       question_patterns,
       cli_mode,
       command_text,
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
       $1, 'network', $2, $3::jsonb, $4::jsonb,
       $5, 'validated', $6, $7, $8, $9, $10, $11, $12,
       $13, $14, $15, $16, $17, $18::jsonb, $19::jsonb, $20::jsonb,
       $21::jsonb, $22::jsonb, $23::jsonb, $24, $25, $26, $27, $28, $29, $30
     )
     RETURNING id`,
    [
      existingItem.id,
      networkDomainPack.manifest.schema_version,
      JSON.stringify(coreCandidate.context),
      JSON.stringify(coreCandidate.payload),
      nextRevision.rows[0]!.next_revision,
      context.vendorId,
      context.platformId,
      context.operatingSystemId,
      candidate.version_min ?? null,
      candidate.version_max ?? null,
      candidate.version_min
        ? normalizeVendorVersion(candidate.version_min)
        : null,
      candidate.version_max
        ? normalizeVendorVersion(candidate.version_max)
        : null,
      candidate.title,
      candidate.summary,
      candidate.question_patterns,
      candidate.cli_mode ?? null,
      candidate.command ?? null,
      JSON.stringify(candidate.procedure),
      JSON.stringify(candidate.prerequisites),
      JSON.stringify(candidate.risks),
      JSON.stringify(candidate.verification),
      JSON.stringify(candidate.rollback),
      JSON.stringify(candidate.limitations),
      candidate.dangerous,
      candidate.risk_level ?? (
        candidate.dangerous ? 'changes_config' : 'safe_read_only'
      ),
      candidate.confidence,
      candidate.quality_score,
      candidate.confidence_reason,
      candidate.last_verified_at,
      createdBy
    ],
  )
  const revisionId = revision.rows[0]!.id

  for (const source of candidate.provenance) {
    const document = await client.query<{ id: string }>(
      `INSERT INTO source_documents (
         domain_id,
         canonical_url,
         document_type,
         title,
         vendor_id,
         document_version,
         document_date,
         verified_at,
         content_hash,
         evidence_fragment
       )
       VALUES ('network', $1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (domain_id, canonical_url, content_hash)
       DO UPDATE SET verified_at = greatest(
         source_documents.verified_at,
         excluded.verified_at
       )
       RETURNING id`,
      [
        source.url,
        source.document_type,
        source.title,
        context.vendorId,
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
       VALUES ($1, $2, $3, $4)`,
      [
        revisionId,
        document.rows[0]!.id,
        source.evidence_role,
        candidate.confidence_reason
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
       'documentation_reviewed',
       $2,
       $3,
       $4::date + CASE WHEN $5 THEN 90 ELSE 180 END
     )`,
    [
      revisionId,
      new Set(
        candidate.provenance.map((source) =>
          `${source.url}\0${source.content_hash}`,
        ),
      ).size,
      candidate.confidence_reason,
      candidate.last_verified_at,
      candidate.dangerous
    ],
  )

  return { itemId: existingItem.id, revisionId }
}

export async function publishKnowledgeBatch(
  client: DatabaseClient,
  items: { itemId: string; revisionId: string }[],
  reason: string,
  createdBy = 'clideck-mcp-worker',
): Promise<{ releaseId: string; sequence: number }> {
  if (items.length === 0) throw new Error('RELEASE_REQUIRES_ITEMS')
  const uniqueItems = [
    ...new Map(
      items.map((item) => [item.itemId, item]),
    ).values()
  ]
  await client.query(
    `SELECT pg_advisory_xact_lock(
       hashtext('clideck-mcp-release-publication')
     )`,
  )
  const current = await client.query<{ release_id: string }>(
    'SELECT release_id FROM active_release WHERE singleton FOR UPDATE',
  )
  const release = await client.query<{ id: string; sequence: number }>(
    `INSERT INTO releases (
       status,
       reason,
       created_by,
       parent_release_id,
       release_mode
     )
     VALUES ('published', $1, $2, $3, 'delta')
     RETURNING id, sequence`,
    [reason, createdBy, current.rows[0]?.release_id ?? null],
  )
  const releaseId = release.rows[0]!.id
  const checkpoint = Number(release.rows[0]!.sequence) % 120 === 0
  await client.query(
    `INSERT INTO release_changes (
       release_id,
       knowledge_item_id,
       previous_revision_id,
       new_revision_id
     )
     SELECT
       $1,
       batch.knowledge_item_id,
       active.revision_id,
       batch.revision_id
     FROM unnest($2::uuid[], $3::uuid[])
       AS batch(knowledge_item_id, revision_id)
     LEFT JOIN active_knowledge_state active
       ON active.knowledge_item_id = batch.knowledge_item_id`,
    [
      releaseId,
      uniqueItems.map((item) => item.itemId),
      uniqueItems.map((item) => item.revisionId)
    ],
  )
  await client.query(
    `INSERT INTO active_knowledge_state (
       knowledge_item_id,
       revision_id,
       activated_release_id
     )
     SELECT
       batch.knowledge_item_id,
       batch.revision_id,
       $1
     FROM unnest($2::uuid[], $3::uuid[])
       AS batch(knowledge_item_id, revision_id)
     ON CONFLICT (knowledge_item_id) DO UPDATE SET
       revision_id = excluded.revision_id,
       activated_release_id = excluded.activated_release_id,
       updated_at = now()`,
    [
      releaseId,
      uniqueItems.map((item) => item.itemId),
      uniqueItems.map((item) => item.revisionId)
    ],
  )

  if (checkpoint) {
    await client.query(
      `UPDATE releases
       SET release_mode = 'checkpoint'
       WHERE id = $1`,
      [releaseId],
    )
    await client.query(
      `INSERT INTO release_items (
         release_id,
         knowledge_item_id,
         revision_id
       )
       SELECT $1, knowledge_item_id, revision_id
       FROM active_knowledge_state`,
      [releaseId],
    )
  }
  await client.query(
    `UPDATE releases
     SET item_count = (
       SELECT count(*)::int FROM active_knowledge_state
     )
     WHERE id = $1`,
    [releaseId],
  )

  if (current.rows[0]) {
    await client.query(
      `UPDATE releases
       SET status = 'superseded'
       WHERE id = $1 AND status = 'published'`,
      [current.rows[0].release_id],
    )
  }
  await client.query(
    `INSERT INTO active_release (singleton, release_id, switched_by)
     VALUES (true, $1, 'clideck-mcp-worker')
     ON CONFLICT (singleton)
     DO UPDATE SET
       release_id = excluded.release_id,
       switched_at = now(),
       switched_by = excluded.switched_by`,
    [releaseId],
  )
  return {
    releaseId,
    sequence: Number(release.rows[0]!.sequence)
  }
}

export async function activateKnowledgeRelease(
  database: Database,
  releaseId: string,
  switchedBy: string,
): Promise<{
  id: string
  sequence: number
  status: string
  reason: string
  created_by: string
  created_at: string
  active: true
  revision_count: number
}> {
  return withTransaction(database, async (client) => {
    await client.query(
      `SELECT pg_advisory_xact_lock(
         hashtext('clideck-mcp-release-publication')
       )`,
    )
    const target = await client.query<{
      id: string
      sequence: number
      status: string
      reason: string
      created_by: string
      created_at: string
    }>(
      `SELECT id, sequence, status, reason, created_by, created_at
       FROM releases
       WHERE id = $1
       FOR UPDATE`,
      [releaseId],
    )
    if (!target.rows[0]) throw new Error('RELEASE_NOT_FOUND')

    const ancestry = await client.query<{
      id: string
      release_mode: 'snapshot' | 'delta' | 'checkpoint'
      depth: number
    }>(
      `WITH RECURSIVE ancestry AS (
         SELECT id, parent_release_id, release_mode, 0 AS depth
         FROM releases
         WHERE id = $1
         UNION ALL
         SELECT
           parent.id,
           parent.parent_release_id,
           parent.release_mode,
           child.depth + 1
         FROM releases parent
         JOIN ancestry child ON child.parent_release_id = parent.id
       )
       SELECT id, release_mode, depth
       FROM ancestry
       ORDER BY depth`,
      [releaseId],
    )
    const base = ancestry.rows.find(
      (release) =>
        release.release_mode === 'snapshot' ||
        release.release_mode === 'checkpoint',
    )
    if (!base) throw new Error('RELEASE_CHECKPOINT_NOT_FOUND')

    await client.query(
      `CREATE TEMP TABLE desired_active_knowledge_state (
         knowledge_item_id uuid PRIMARY KEY,
         revision_id uuid NOT NULL
       ) ON COMMIT DROP`,
    )
    await client.query(
      `INSERT INTO desired_active_knowledge_state (
         knowledge_item_id,
         revision_id
       )
       SELECT knowledge_item_id, revision_id
       FROM release_items
       WHERE release_id = $1`,
      [base.id],
    )
    const forward = ancestry.rows
      .filter((release) => release.depth < base.depth)
      .sort((left, right) => right.depth - left.depth)
    for (const release of forward) {
      await client.query(
        `INSERT INTO desired_active_knowledge_state (
           knowledge_item_id,
           revision_id
         )
         SELECT knowledge_item_id, new_revision_id
         FROM release_changes
         WHERE release_id = $1
         ON CONFLICT (knowledge_item_id) DO UPDATE SET
           revision_id = excluded.revision_id`,
        [release.id],
      )
    }

    await client.query('DELETE FROM active_knowledge_state')
    await client.query(
      `INSERT INTO active_knowledge_state (
         knowledge_item_id,
         revision_id,
         activated_release_id
       )
       SELECT knowledge_item_id, revision_id, $1
       FROM desired_active_knowledge_state`,
      [releaseId],
    )
    await client.query(
      `UPDATE releases
       SET status = CASE
         WHEN id = $1 THEN 'published'
         WHEN status = 'published' THEN 'superseded'
         ELSE status
       END
       WHERE id = $1 OR status = 'published'`,
      [releaseId],
    )
    await client.query(
      `INSERT INTO active_release (singleton, release_id, switched_by)
       VALUES (true, $1, $2)
       ON CONFLICT (singleton) DO UPDATE SET
         release_id = excluded.release_id,
         switched_at = now(),
         switched_by = excluded.switched_by`,
      [releaseId, switchedBy],
    )
    const count = await client.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM active_knowledge_state',
    )
    return {
      ...target.rows[0],
      active: true,
      revision_count: count.rows[0]?.count ?? 0
    }
  })
}

export async function processNextCandidate(
  database: Database,
  config: AppConfig,
  logger: Logger,
): Promise<boolean> {
  const candidateTask = await withTransaction(database, async (client) => {
    const result = await client.query<CandidateTaskRow>(
      `SELECT
         et.id,
         et.public_id,
         ta.id AS artifact_id,
         ta.payload
       FROM expert_tasks et
       JOIN LATERAL (
         SELECT id, payload
         FROM task_artifacts
         WHERE task_id = et.id
           AND artifact_type = 'candidate_revision'
         ORDER BY created_at DESC
         LIMIT 1
       ) ta ON true
       WHERE et.status = 'validating'
       ORDER BY et.updated_at
       FOR UPDATE OF et SKIP LOCKED
       LIMIT 1`,
    )
    const task = result.rows[0]
    if (!task) return null
    const reserved = await client.query<{ id: string }>(
      `UPDATE expert_tasks
       SET status = 'publishing',
           claim_owner = 'knowledge-worker',
           lease_until = now() + interval '10 minutes',
           updated_at = now()
       WHERE id = $1
         AND status = 'validating'
       RETURNING id`,
      [task.id],
    )
    return reserved.rows[0] ? task : null
  })

  if (!candidateTask) return false

  try {
    const candidate = storedCandidateSchema.parse(candidateTask.payload)
    const threshold = candidate.dangerous
      ? config.dangerousAutoPublishConfidence
      : config.autoPublishConfidence

    if (
      candidate.confidence < threshold ||
      candidate.quality_score < 0.85
    ) {
      await database.query(
        `UPDATE expert_tasks
            SET status = 'failed',
                failure_code = 'MANUAL_REVIEW_REQUIRED',
                failure_message = 'Candidate retained internally; automatic publication threshold was not met.',
                claim_owner = NULL,
                lease_until = NULL,
                completed_at = now(),
                updated_at = now()
          WHERE id = $1 AND status = 'publishing'`,
        [candidateTask.id],
      )
      return true
    }

    const publication = await withTransaction(database, async (client) => {
      const lockedTask = await client.query<{ id: string }>(
        `SELECT id
         FROM expert_tasks
         WHERE id = $1
           AND status = 'publishing'
           AND lease_until > now()
         FOR UPDATE`,
        [candidateTask.id],
      )
      if (!lockedTask.rows[0]) throw new Error('PUBLICATION_LEASE_INVALID')
      await client.query(
        `INSERT INTO task_public_events (
           task_id, stage, progress_percent, public_message
         )
         VALUES (
           $1,
           'conflict_check',
           72,
           'Candidate passed schema validation and entered conflict checks.'
         )`,
        [candidateTask.id],
      )
      const blockingConflict = await client.query<{ exists: boolean }>(
        `SELECT EXISTS (
           SELECT 1
           FROM knowledge_conflicts
           WHERE status = 'open' AND severity = 'blocking'
         ) AS exists`,
      )
      if (blockingConflict.rows[0]?.exists) {
        throw new Error('BLOCKING_KNOWLEDGE_CONFLICT')
      }

      await client.query(
        `INSERT INTO task_public_events (
           task_id, stage, progress_percent, public_message
         )
         VALUES (
           $1,
           'publishing',
           88,
           'Validated knowledge is being added to an immutable release.'
         )`,
        [candidateTask.id],
      )
      const { itemId, revisionId } = await createKnowledgeRevision(
        client,
        candidate,
      )
      const release = await publishKnowledgeBatch(
        client,
        [{ itemId, revisionId }],
        `Published validated expert task ${candidateTask.public_id}`,
      )
      const validationPayload = {
        policy_version: 1,
        confidence_threshold: threshold,
        quality_threshold: 0.85,
        dangerous: candidate.dangerous,
        decision: 'published',
        release_id: release.releaseId,
        revision_id: revisionId
      }
      await client.query(
        `INSERT INTO task_artifacts (
           task_id, artifact_type, payload, content_hash
         )
         VALUES ($1, 'validation_report', $2::jsonb, $3)`,
        [
          candidateTask.id,
          JSON.stringify(validationPayload),
          sha256Label(JSON.stringify(validationPayload))
        ],
      )
      await client.query(
        `UPDATE expert_tasks
            SET status = 'completed',
                result_revision_id = $2,
                result_payload = $3::jsonb,
                claim_owner = NULL,
                lease_until = NULL,
                completed_at = now(),
                updated_at = now()
          WHERE id = $1 AND status = 'publishing'`,
        [
          candidateTask.id,
          revisionId,
          JSON.stringify({ release_id: release.releaseId })
        ],
      )
      await client.query(
        `UPDATE agent_runs
            SET published_revisions = 1
          WHERE pipeline_task_id IN (
            SELECT id
            FROM pipeline_tasks
            WHERE expert_task_id = $1
          )`,
        [candidateTask.id],
      )
      await client.query(
        `INSERT INTO task_public_events (
           task_id, stage, progress_percent, public_message
         )
         VALUES (
           $1,
           'completed',
           100,
           'Knowledge published and available for deterministic reuse.'
         )`,
        [candidateTask.id],
      )
      return { releaseId: release.releaseId, revisionId }
    })
    logger.info(
      {
        taskId: candidateTask.public_id,
        releaseId: publication.releaseId,
        revisionId: publication.revisionId
      },
      'Published candidate knowledge',
    )
  } catch (error) {
    logger.error(
      { err: error, taskId: candidateTask.public_id },
      'Candidate validation failed',
    )
    await database.query(
      `WITH inserted_event AS (
         INSERT INTO task_public_events (
           task_id, stage, progress_percent, public_message
         )
         VALUES (
           $1,
           'failed',
           100,
           'Candidate did not pass the publication policy gate.'
         )
       )
       UPDATE expert_tasks
          SET status = 'failed',
              failure_code = 'VALIDATION_FAILED',
              failure_message = 'Candidate failed the structured validation or publication gate.',
              claim_owner = NULL,
              lease_until = NULL,
              completed_at = now(),
              updated_at = now()
        WHERE id = $1 AND status = 'publishing'`,
      [candidateTask.id],
    )
  }
  return true
}

export async function runWorkerMaintenance(
  database: Database,
  instanceId: string,
): Promise<void> {
  await withTransaction(database, async (client) => {
    await client.query(
      `INSERT INTO worker_heartbeats (
         worker_name, instance_id, heartbeat_at, metadata
       )
       VALUES ('knowledge-worker', $1, now(), '{"status":"running"}'::jsonb)
       ON CONFLICT (worker_name)
       DO UPDATE SET
         instance_id = excluded.instance_id,
         heartbeat_at = excluded.heartbeat_at,
         metadata = excluded.metadata`,
      [instanceId],
    )
    await client.query(
      `UPDATE expert_tasks
          SET status = 'expired',
              lease_token_hash = NULL,
              lease_until = NULL,
              completed_at = now(),
              updated_at = now()
        WHERE expires_at <= now()
          AND status NOT IN ('completed', 'failed', 'cancelled', 'expired')`,
    )
    await client.query(
      `UPDATE expert_tasks
          SET status = CASE WHEN attempts >= 5 THEN 'failed' ELSE 'queued' END,
              failure_code = CASE WHEN attempts >= 5 THEN 'LEASE_ATTEMPTS_EXHAUSTED' ELSE NULL END,
              failure_message = CASE
                WHEN attempts >= 5 THEN 'Research lease expired too many times.'
                ELSE NULL
              END,
              claim_owner = NULL,
              lease_token_hash = NULL,
              lease_until = NULL,
              updated_at = now(),
              completed_at = CASE WHEN attempts >= 5 THEN now() ELSE NULL END
        WHERE status IN ('claimed', 'researching')
          AND lease_until <= now()`,
    )
    await client.query(
      `UPDATE expert_tasks
          SET status = 'validating',
              claim_owner = NULL,
              lease_until = NULL,
              updated_at = now()
        WHERE status = 'publishing'
          AND lease_until <= now()`,
    )
    await client.query(
      `DELETE FROM rate_limit_buckets
       WHERE window_start < now() - interval '2 days'`,
    )
    await client.query(
      `DELETE FROM snapshot_contributions
       WHERE expires_at <= now()`,
    )
  })
}
