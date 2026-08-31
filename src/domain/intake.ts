import { createHash, randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { basename, extname, join, resolve } from 'node:path'

import { z } from 'zod'

import type { AppConfig } from '../config.js'
import { sha256Label } from '../crypto.js'
import type { Database, DatabaseClient } from '../db.js'
import { withTransaction } from '../db.js'
import {
  isUrlInsideCollectionScope,
  publicSourceLocator,
  sanitizeFieldLog,
  sourceKindSchema,
  type SourceKind
} from './pipeline-v2.js'

const sourceRef = () => `src_${randomUUID().replaceAll('-', '')}`
const uploadRef = () => `upl_${randomUUID().replaceAll('-', '')}`
const processingVersion = () =>
  `pipeline-v2-${new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14)}-${randomUUID().slice(0, 8)}`

export const websiteIntakeSchema = z.strictObject({
  root_url: z.url().startsWith('https://'),
  title: z.string().trim().min(1).max(500).optional(),
  page_limit: z.number().int().min(1).max(50_000).default(5_000),
  vendor: z.string().trim().min(1).max(120).optional(),
  operating_system: z.string().trim().min(1).max(120).optional(),
  model: z.string().trim().min(1).max(120).optional()
})

export const uploadMetadataSchema = z.strictObject({
  title: z.string().trim().min(1).max(500),
  file_name: z.string().trim().min(1).max(500),
  source_kind: sourceKindSchema.refine(
    (kind) => ['admin_document', 'pasted_text', 'field_log'].includes(kind),
  ),
  media_type: z.string().trim().min(1).max(120),
  vendor: z.string().trim().min(1).max(120).optional(),
  operating_system: z.string().trim().min(1).max(120).optional(),
  model: z.string().trim().min(1).max(120).optional()
})

const allowedUploadMedia = new Set([
  'application/pdf',
  'text/plain',
  'text/markdown',
  'text/html',
  'text/csv',
  'application/json',
  'application/x-ndjson'
])
const allowedExtensions = new Set([
  '.pdf', '.txt', '.md', '.html', '.htm', '.csv', '.json', '.jsonl', '.log'
])

function sniffMediaType(bytes: Buffer, declared: string, fileName: string): string {
  const extension = extname(fileName).toLowerCase()
  if (!allowedExtensions.has(extension)) throw new Error('UPLOAD_FILE_TYPE_NOT_ALLOWED')
  if (bytes.subarray(0, 5).toString('ascii') === '%PDF-') return 'application/pdf'
  if (declared === 'application/pdf') throw new Error('UPLOAD_MIME_MISMATCH')
  if (allowedUploadMedia.has(declared)) return declared
  if (declared === 'application/octet-stream') {
    if (extension === '.json') return 'application/json'
    if (extension === '.jsonl') return 'application/x-ndjson'
    if (extension === '.html' || extension === '.htm') return 'text/html'
    if (extension === '.csv') return 'text/csv'
    if (extension === '.md') return 'text/markdown'
    return 'text/plain'
  }
  throw new Error('UPLOAD_MIME_NOT_ALLOWED')
}

async function writeStreamToFile(
  body: ReadableStream<Uint8Array>,
  destination: string,
  maximumBytes: number,
): Promise<{ byteSize: number; hash: string; prefix: Buffer }> {
  const handle = await open(destination, 'wx', 0o600)
  const digest = createHash('sha256')
  const reader = body.getReader()
  let byteSize = 0
  const prefixChunks: Buffer[] = []
  let prefixBytes = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      const chunk = Buffer.from(value)
      byteSize += chunk.byteLength
      if (byteSize > maximumBytes) throw new Error('UPLOAD_TOO_LARGE')
      digest.update(chunk)
      if (prefixBytes < 4_096) {
        const retained = chunk.subarray(0, 4_096 - prefixBytes)
        prefixChunks.push(retained)
        prefixBytes += retained.byteLength
      }
      await handle.write(chunk)
    }
    if (byteSize === 0) throw new Error('UPLOAD_EMPTY')
    await handle.sync()
    return {
      byteSize,
      hash: `sha256:${digest.digest('hex')}`,
      prefix: Buffer.concat(prefixChunks)
    }
  } finally {
    await handle.close()
    reader.releaseLock()
  }
}

async function createProcessingRun(
  client: DatabaseClient,
  sourceId: string,
  artifactId: string,
  version: string,
): Promise<string> {
  const result = await client.query<{ id: string }>(
    `INSERT INTO source_processing_runs (
       source_candidate_id, source_artifact_id, processing_version,
       converter_version, segmenter_version, extractor_version,
       prompt_version, model_profile, status, started_at
     ) VALUES (
       $1, $2, $3, 'pipeline-v2-convert-1', 'pipeline-v2-segment-1',
       'pipeline-v2-extract-1', 'pipeline-v2-fidelity-1',
       'gpt-5.6-luna-low', 'converting', now()
     ) RETURNING id`,
    [sourceId, artifactId, version],
  )
  return result.rows[0]!.id
}

async function queueUploadedSource(
  client: DatabaseClient,
  input: {
    sourceId: string
    processingRunId: string
    locator: string
    title: string
    documentType: string
  },
): Promise<void> {
  await client.query(
    `INSERT INTO pipeline_tasks (
       task_type, stage, status, priority, source_candidate_id,
       processing_run_id, dedupe_key, payload
     ) VALUES (
       'source_conversion', 'convert', 'queued', 60, $1::uuid, $2::uuid, $3,
       jsonb_build_object(
         'source_id', ($1::uuid)::text,
         'canonical_url', $4::text,
         'document_type', $5::text,
         'title', $6::text,
         'processing_run_id', ($2::uuid)::text
       )
     ) ON CONFLICT DO NOTHING`,
    [
      input.sourceId,
      input.processingRunId,
      `processing-run:${input.processingRunId}:convert`,
      input.locator,
      input.documentType,
      input.title
    ],
  )
}

export async function createWebsiteIntakeJob(
  database: Database,
  input: z.infer<typeof websiteIntakeSchema>,
  actorId: string,
): Promise<{ job_id: string; collection_id: string; path_prefix: string }> {
  const parsed = websiteIntakeSchema.parse(input)
  const root = new URL(parsed.root_url)
  root.hash = ''
  const pathPrefix = root.pathname.endsWith('/')
    ? root.pathname
    : root.pathname.slice(0, root.pathname.lastIndexOf('/') + 1) || '/'
  if (!isUrlInsideCollectionScope(root.toString(), root.toString(), pathPrefix)) {
    throw new Error('INTAKE_WEBSITE_SCOPE_INVALID')
  }
  return withTransaction(database, async (client) => {
    const job = await client.query<{ id: string }>(
      `INSERT INTO intake_jobs (job_type, status, created_by, configuration)
       VALUES ('website', 'queued', $1, $2::jsonb)
       RETURNING id`,
      [actorId, JSON.stringify({ ...parsed, path_prefix: pathPrefix })],
    )
    const collection = await client.query<{ id: string }>(
      `INSERT INTO source_collections (
         coverage_target_id, canonical_url, vendor_domain, collection_type,
         status, crawl_depth, link_limit, path_prefix, intake_job_id,
         next_scan_at
       ) VALUES (
         NULL, $1, $2, 'manual_root', 'active', 100, $3, $4, $5, now()
       )
       ON CONFLICT (canonical_url) DO UPDATE SET
         link_limit = excluded.link_limit,
         path_prefix = excluded.path_prefix,
         intake_job_id = excluded.intake_job_id,
         status = 'active',
         next_scan_at = now(),
         updated_at = now()
       RETURNING id`,
      [root.toString(), root.hostname.toLowerCase(), parsed.page_limit, pathPrefix, job.rows[0]!.id],
    )
    await client.query(
      `INSERT INTO source_collection_pages (
         source_collection_id, requested_url, depth
       ) VALUES ($1, $2, 0)
       ON CONFLICT DO NOTHING`,
      [collection.rows[0]!.id, root.toString()],
    )
    await client.query(
      `INSERT INTO admin_audit_events (
         actor_id, actor_role, action, target_type, target_id, metadata
       ) VALUES ($1, 'super_admin', 'intake.website', 'intake_job', $2,
         jsonb_build_object('root_url', $3::text, 'page_limit', $4::int))`,
      [actorId, job.rows[0]!.id, root.toString(), parsed.page_limit],
    )
    return {
      job_id: job.rows[0]!.id,
      collection_id: collection.rows[0]!.id,
      path_prefix: pathPrefix
    }
  })
}

export async function acceptSourceUpload(
  database: Database,
  config: AppConfig,
  metadataInput: z.infer<typeof uploadMetadataSchema>,
  body: ReadableStream<Uint8Array>,
  actorId: string,
  existingJobId: string | null = null,
): Promise<{ job_id: string; source_id: string; processing_run_id: string }> {
  const metadata = uploadMetadataSchema.parse(metadataInput)
  const stagingRoot = resolve(config.sourceStorageDir, '.intake-staging')
  const artifactRoot = resolve(config.sourceStorageDir)
  await mkdir(stagingRoot, { recursive: true, mode: 0o700 })
  await mkdir(artifactRoot, { recursive: true, mode: 0o750 })
  const currentUploadRef = uploadRef()
  const temporaryPath = join(stagingRoot, `.${currentUploadRef}.part`)
  let finalArtifactPath: string | null = null
  try {
    const streamed = await writeStreamToFile(
      body,
      temporaryPath,
      metadata.source_kind === 'pasted_text' ? 5 * 1024 * 1024 : 100 * 1024 * 1024,
    )
    const mediaType = sniffMediaType(
      streamed.prefix,
      metadata.media_type,
      metadata.file_name,
    )
    const isLog = metadata.source_kind === 'field_log'
    let contentHash = streamed.hash
    if (isLog) {
      const raw = await readFile(temporaryPath, 'utf8')
      const result = sanitizeFieldLog(raw)
      const sanitized = Buffer.from(result.sanitized, 'utf8')
      contentHash = sha256Label(result.sanitized)
      await writeFile(temporaryPath, sanitized, { mode: 0o600 })
    }
    const currentSourceRef = sourceRef()
    const safeExtension = mediaType === 'application/pdf'
      ? '.pdf'
      : isLog ? '.log' : '.txt'
    finalArtifactPath = join(artifactRoot, `${currentSourceRef}-${contentHash.slice(-16)}${safeExtension}`)
    await rename(temporaryPath, finalArtifactPath)
    const locator = publicSourceLocator(config.publicBaseUrl, currentSourceRef)
    return await withTransaction(database, async (client) => {
      const jobType = isLog
        ? 'logs'
        : metadata.source_kind === 'pasted_text' ? 'paste_text' : 'files'
      let jobId = existingJobId
      if (jobId) {
        const existing = await client.query<{
          id: string
          files: number
          bytes: number
        }>(
          `SELECT job.id,
                  count(upload.id)::int AS files,
                  coalesce(sum(upload.byte_size), 0)::bigint AS bytes
             FROM intake_jobs job
             LEFT JOIN source_uploads upload ON upload.intake_job_id = job.id
            WHERE job.id = $1 AND job.created_by = $2 AND job.job_type = $3
              AND job.status IN ('queued', 'running')
            GROUP BY job.id
            FOR UPDATE OF job`,
          [jobId, actorId, jobType],
        )
        if (!existing.rows[0]) throw new Error('UPLOAD_JOB_NOT_AVAILABLE')
        if (existing.rows[0].files >= 100) throw new Error('UPLOAD_JOB_FILE_LIMIT')
        if (Number(existing.rows[0].bytes) + streamed.byteSize > 1024 ** 3) {
          throw new Error('UPLOAD_JOB_SIZE_LIMIT')
        }
      } else {
        const job = await client.query<{ id: string }>(
          `INSERT INTO intake_jobs (
             job_type, status, created_by, configuration, counters, started_at
           ) VALUES (
             $1, 'running', $2, $3::jsonb, '{}'::jsonb, now()
           ) RETURNING id`,
          [
            jobType,
            actorId,
            JSON.stringify({ title: metadata.title, source_kind: metadata.source_kind })
          ],
        )
        jobId = job.rows[0]!.id
      }
      const source = await client.query<{ id: string }>(
        `INSERT INTO source_candidates (
           coverage_target_id, canonical_url, document_type, title, status,
           discovered_by, content_hash, source_kind, source_ref,
           display_locator, declared_vendor, declared_operating_system,
           declared_model
         ) VALUES (
           NULL, NULL, $1, $2, 'acquired', 'admin-intake', $3, $4, $5,
           $6, $7, $8, $9
         ) RETURNING id`,
        [
          isLog ? 'field_log' : metadata.source_kind === 'pasted_text' ? 'pasted_text' : 'admin_document',
          metadata.title,
          contentHash,
          metadata.source_kind,
          currentSourceRef,
          metadata.file_name,
          metadata.vendor ?? null,
          metadata.operating_system ?? null,
          metadata.model ?? null
        ],
      )
      const artifact = await client.query<{ id: string }>(
        `INSERT INTO source_artifacts (
           source_candidate_id, media_type, byte_size, content_hash,
           storage_path, status, purge_after
         ) VALUES ($1, $2, $3, $4, $5, 'downloaded', NULL)
         RETURNING id`,
        [source.rows[0]!.id, mediaType, streamed.byteSize, contentHash, finalArtifactPath],
      )
      await client.query(
        `INSERT INTO source_uploads (
           intake_job_id, upload_ref, original_name, media_type, byte_size,
           original_content_hash, sanitized_content_hash, staging_path, status
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, NULL, 'accepted')`,
        [
          jobId,
          currentUploadRef,
          basename(metadata.file_name),
          mediaType,
          streamed.byteSize,
          streamed.hash,
          isLog ? contentHash : null
        ],
      )
      const version = processingVersion()
      const runId = await createProcessingRun(
        client,
        source.rows[0]!.id,
        artifact.rows[0]!.id,
        version,
      )
      await client.query(
        `INSERT INTO intake_job_sources (
           intake_job_id, source_candidate_id, processing_version, status
         ) VALUES ($1, $2, $3, 'running')`,
        [jobId, source.rows[0]!.id, version],
      )
      await client.query(
        `UPDATE intake_jobs
            SET counters = counters || jsonb_build_object(
                  'files', (SELECT count(*)::int FROM source_uploads
                             WHERE intake_job_id = $1),
                  'bytes', (SELECT coalesce(sum(byte_size), 0)::bigint
                             FROM source_uploads WHERE intake_job_id = $1)
                ),
                updated_at = now()
          WHERE id = $1`,
        [jobId],
      )
      await queueUploadedSource(client, {
        sourceId: source.rows[0]!.id,
        processingRunId: runId,
        locator,
        title: metadata.title,
        documentType: isLog ? 'field_log' : 'admin_document'
      })
      await client.query(
        `INSERT INTO admin_audit_events (
           actor_id, actor_role, action, target_type, target_id, metadata
         ) VALUES ($1, 'super_admin', 'intake.upload', 'source_candidate', $2,
           jsonb_build_object('job_id', $3::text, 'source_kind', $4::text,
             'byte_size', $5::bigint, 'original_hash', $6::text))`,
        [actorId, source.rows[0]!.id, jobId, metadata.source_kind, streamed.byteSize, streamed.hash],
      )
      return {
        job_id: jobId!,
        source_id: source.rows[0]!.id,
        processing_run_id: runId
      }
    })
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined)
    if (finalArtifactPath) await unlink(finalArtifactPath).catch(() => undefined)
    throw error
  }
}

export async function listIntakeJobs(database: Database) {
  const result = await database.query(
    `SELECT id, job_type AS job_kind, status,
            COALESCE(configuration->>'title',
              CASE job_type
                WHEN 'website' THEN COALESCE(configuration->>'root_url', 'Website crawl')
                WHEN 'reprocess' THEN 'Reprocess source materials'
                ELSE initcap(replace(job_type, '_', ' '))
              END) AS title,
            COALESCE((counters->>'sources')::int, (counters->>'files')::int, 0) AS total_items,
            (SELECT count(*)::int FROM intake_job_sources item WHERE item.intake_job_id = intake_jobs.id AND item.status = 'queued') AS queued_items,
            (SELECT count(*)::int FROM intake_job_sources item WHERE item.intake_job_id = intake_jobs.id AND item.status = 'running') AS running_items,
            (SELECT count(*)::int FROM intake_job_sources item WHERE item.intake_job_id = intake_jobs.id AND item.status = 'completed') AS completed_items,
            (SELECT count(*)::int FROM intake_job_sources item WHERE item.intake_job_id = intake_jobs.id AND item.status = 'failed') AS failed_items,
            (SELECT count(*)::int FROM intake_job_sources item WHERE item.intake_job_id = intake_jobs.id AND item.status = 'unavailable') AS unavailable_items,
            configuration->>'current_stage' AS current_stage,
            failure_message AS last_error, completed_at, created_at, updated_at
       FROM intake_jobs
      ORDER BY created_at DESC
      LIMIT 100`,
  )
  return result.rows
}

export async function controlIntakeJob(
  database: Database,
  jobId: string,
  action: 'pause' | 'resume' | 'cancel' | 'retry',
  actorId: string,
) {
  const nextByAction = {
    pause: 'paused',
    resume: 'queued',
    cancel: 'cancelled',
    retry: 'queued'
  } as const
  return withTransaction(database, async (client) => {
    const updated = await client.query(
      `UPDATE intake_jobs
          SET status = $2,
              failure_message = CASE WHEN $2 = 'queued' THEN NULL ELSE failure_message END,
              completed_at = CASE WHEN $2 = 'cancelled' THEN now() ELSE NULL END,
              updated_at = now()
        WHERE id = $1
          AND status NOT IN ('completed', 'cancelled')
        RETURNING *`,
      [jobId, nextByAction[action]],
    )
    if (!updated.rows[0]) return null
    if (action === 'cancel') {
      await client.query(
        `UPDATE intake_job_sources
            SET status = 'cancelled', updated_at = now()
          WHERE intake_job_id = $1 AND status = 'queued'`,
        [jobId],
      )
    }
    if (action === 'retry') {
      await client.query(
        `UPDATE intake_job_sources
            SET status = 'queued', result = '{}'::jsonb, updated_at = now()
          WHERE intake_job_id = $1 AND status = 'failed'`,
        [jobId],
      )
    }
    await client.query(
      `INSERT INTO admin_audit_events (
         actor_id, actor_role, action, target_type, target_id
       ) VALUES ($1, 'super_admin', $2, 'intake_job', $3)`,
      [actorId, `intake.${action}`, jobId],
    )
    return updated.rows[0]
  })
}

const activeProcessingRunStatuses = [
  'queued', 'acquiring', 'converting', 'segmenting', 'extracting',
  'auditing', 'repairing', 'reconciling', 'normalizing', 'publishing', 'paused'
] as const

/**
 * Close run-bound work after a terminal task failure or an operator cancel.
 * Every write is scoped by processing_run_id so a delayed task from an older
 * processing version cannot fail the current run for the same source.
 */
export async function reconcileTerminalProcessingRunsWithClient(
  client: DatabaseClient,
  processingRunIds: string[] | null = null,
): Promise<number> {
  const reconciled = await client.query<{ id: string }>(
    `WITH terminal AS (
       SELECT run.id,
              CASE
                WHEN job.status = 'cancelled' THEN 'cancelled'
                ELSE 'failed'
              END AS terminal_status,
              coalesce(task.failure_code,
                CASE WHEN job.status = 'cancelled'
                  THEN 'INTAKE_JOB_CANCELLED'
                  ELSE 'PROCESSING_TASK_FAILED' END
              ) AS failure_code,
              coalesce(task.failure_message,
                CASE WHEN job.status = 'cancelled'
                  THEN 'The intake job was cancelled by an administrator.'
                  ELSE 'A terminal run-bound pipeline task failed.' END
              ) AS failure_message
         FROM source_processing_runs run
         LEFT JOIN LATERAL (
           SELECT failed.id AS task_id,
                  failed.failure_code, failed.failure_message
             FROM pipeline_tasks failed
            WHERE failed.processing_run_id = run.id
              AND failed.status = 'failed'
            ORDER BY failed.completed_at DESC NULLS LAST, failed.updated_at DESC
            LIMIT 1
         ) task ON true
         LEFT JOIN intake_job_sources item
           ON item.source_candidate_id = run.source_candidate_id
          AND item.processing_version = run.processing_version
         LEFT JOIN intake_jobs job ON job.id = item.intake_job_id
        WHERE run.status = ANY($1::text[])
          AND ($2::uuid[] IS NULL OR run.id = ANY($2::uuid[]))
          AND (
            task.task_id IS NOT NULL
            OR (
              job.status = 'cancelled'
              AND NOT EXISTS (
                SELECT 1 FROM pipeline_tasks live
                WHERE live.processing_run_id = run.id
                   AND live.status IN ('claimed', 'running')
                   AND live.lease_until > now()
              )
            )
          )
        FOR UPDATE OF run SKIP LOCKED
     ), updated AS (
       UPDATE source_processing_runs run
          SET status = terminal.terminal_status,
              failure_code = terminal.failure_code,
              failure_message = terminal.failure_message,
              completed_at = now(),
              updated_at = now()
         FROM terminal
        WHERE run.id = terminal.id
        RETURNING run.id
     )
     SELECT id FROM updated`,
    [activeProcessingRunStatuses, processingRunIds],
  )
  const runIds = reconciled.rows.map((row) => row.id)
  if (runIds.length === 0) return 0

  await client.query(
    `UPDATE pipeline_tasks
        SET status = 'cancelled',
            claim_owner = NULL,
            lease_token_hash = NULL,
            lease_until = NULL,
            heartbeat_at = NULL,
            failure_code = coalesce(failure_code, 'PROCESSING_RUN_TERMINATED'),
            failure_message = coalesce(
              failure_message,
              'Task cancelled because its processing run is terminal.'
            ),
            completed_at = coalesce(completed_at, now()),
            updated_at = now()
      WHERE processing_run_id = ANY($1::uuid[])
        AND status IN ('queued', 'claimed', 'running')`,
    [runIds],
  )
  await client.query(
    `UPDATE source_fragments fragment
        SET status = 'failed',
            reservation_task_id = NULL,
            updated_at = now()
      WHERE fragment.processing_run_id = ANY($1::uuid[])
        AND fragment.status IN ('queued', 'reserved', 'analyzing')`,
    [runIds],
  )
  await client.query(
    `UPDATE intake_job_sources item
        SET status = CASE WHEN run.status = 'cancelled'
                          THEN 'cancelled' ELSE 'failed' END,
            result = item.result || jsonb_build_object(
              'failure_code', run.failure_code,
              'failure_message', run.failure_message
            ),
            updated_at = now()
       FROM source_processing_runs run
      WHERE run.id = ANY($1::uuid[])
        AND item.source_candidate_id = run.source_candidate_id
        AND item.processing_version = run.processing_version
        AND item.status IN ('queued', 'running')`,
    [runIds],
  )
  await client.query(
    `UPDATE intake_jobs job
        SET status = CASE
              WHEN job.status = 'cancelled' THEN 'cancelled'
              WHEN EXISTS (
                SELECT 1 FROM intake_job_sources failed
                 WHERE failed.intake_job_id = job.id
                   AND failed.status IN ('failed', 'unavailable')
              ) THEN 'completed_with_errors'
              ELSE 'completed'
            END,
            completed_at = now(),
            updated_at = now()
      WHERE job.status IN ('queued', 'running', 'cancelled')
        AND EXISTS (
          SELECT 1 FROM intake_job_sources member
           WHERE member.intake_job_id = job.id
             AND member.source_candidate_id IN (
               SELECT run.source_candidate_id
                 FROM source_processing_runs run
                WHERE run.id = ANY($1::uuid[])
             )
        )
        AND NOT EXISTS (
          SELECT 1 FROM intake_job_sources open_item
           WHERE open_item.intake_job_id = job.id
             AND open_item.status IN ('queued', 'running')
        )`,
    [runIds],
  )
  await client.query(
    `DELETE FROM active_source_slots slot
      WHERE slot.source_candidate_id IN (
        SELECT run.source_candidate_id
          FROM source_processing_runs run
         WHERE run.id = ANY($1::uuid[])
      )
        AND NOT EXISTS (
          SELECT 1 FROM source_processing_runs newer
           WHERE newer.source_candidate_id = slot.source_candidate_id
             AND newer.id <> ALL($1::uuid[])
             AND newer.status = ANY($2::text[])
        )`,
    [runIds, activeProcessingRunStatuses],
  )
  return runIds.length
}

export async function reconcileTerminalProcessingRuns(
  database: Database,
  processingRunIds: string[] | null = null,
): Promise<number> {
  return withTransaction(
    database,
    (client) => reconcileTerminalProcessingRunsWithClient(
      client,
      processingRunIds,
    ),
  )
}

export async function createReprocessJob(
  database: Database,
  sourceIds: string[] | null,
  actorId: string,
): Promise<{ job_id: string; eligible: number; unavailable: number }> {
  return withTransaction(database, async (client) => {
    const selected = await client.query<{
      id: string
      artifact_id: string | null
      source_kind: SourceKind
      artifact_status: string | null
    }>(
      `SELECT source.id, artifact.id AS artifact_id, source.source_kind,
              artifact.status AS artifact_status
         FROM source_candidates source
         LEFT JOIN LATERAL (
           SELECT current_artifact.id, current_artifact.status
             FROM source_artifacts current_artifact
            WHERE current_artifact.source_candidate_id = source.id
            ORDER BY current_artifact.acquired_at DESC
            LIMIT 1
         ) artifact ON true
        WHERE ($1::uuid[] IS NULL OR source.id = ANY($1::uuid[]))
          AND source.status <> 'rejected'
        ORDER BY source.discovered_at`,
      [sourceIds],
    )
    const job = await client.query<{ id: string }>(
      `INSERT INTO intake_jobs (
         job_type, status, created_by, configuration, counters
       ) VALUES (
         'reprocess', 'queued', $1, $2::jsonb,
         jsonb_build_object('sources', $3::int)
       ) RETURNING id`,
      [actorId, JSON.stringify({ mode: sourceIds ? 'selected' : 'all' }), selected.rows.length],
    )
    let unavailable = 0
    for (const source of selected.rows) {
      const version = processingVersion()
      const available = source.artifact_id && source.artifact_status !== 'purged'
      if (!available && source.source_kind !== 'official_web' && source.source_kind !== 'admin_web') {
        unavailable += 1
      }
      const shouldRedownload = !available && (
        source.source_kind === 'official_web' || source.source_kind === 'admin_web'
      )
      await client.query(
        `INSERT INTO intake_job_sources (
           intake_job_id, source_candidate_id, processing_version, status
         ) VALUES ($1, $2, $3, $4)`,
        [job.rows[0]!.id, source.id, version, available || shouldRedownload ? 'queued' : 'unavailable'],
      )
    }
    await client.query(
      `UPDATE intake_jobs
          SET counters = counters || jsonb_build_object(
            'eligible', $2::int, 'unavailable', $3::int
          ), updated_at = now()
        WHERE id = $1`,
      [job.rows[0]!.id, selected.rows.length - unavailable, unavailable],
    )
    return {
      job_id: job.rows[0]!.id,
      eligible: selected.rows.length - unavailable,
      unavailable
    }
  })
}

export async function previewReprocessJob(
  database: Database,
  sourceIds: string[] | null,
): Promise<{
  sources: number
  eligible: number
  unavailable: number
  active_runs: number
  estimated_bytes: number
}> {
  const result = await database.query<{
    sources: number
    eligible: number
    unavailable: number
    active_runs: number
    estimated_bytes: number
  }>(
    `SELECT count(*)::int AS sources,
            count(*) FILTER (WHERE artifact.id IS NOT NULL
              OR source.source_kind IN ('official_web', 'admin_web'))::int AS eligible,
            count(*) FILTER (WHERE artifact.id IS NULL
              AND source.source_kind NOT IN ('official_web', 'admin_web'))::int AS unavailable,
            count(*) FILTER (WHERE run.status IN (
              'queued', 'acquiring', 'converting', 'segmenting', 'extracting',
              'auditing', 'repairing', 'reconciling', 'normalizing', 'publishing'
            ))::int AS active_runs,
            coalesce(sum(artifact.byte_size), 0)::bigint AS estimated_bytes
       FROM source_candidates source
       LEFT JOIN LATERAL (
         SELECT current.id, current.byte_size
           FROM source_artifacts current
          WHERE current.source_candidate_id = source.id
            AND current.status <> 'purged'
          ORDER BY current.acquired_at DESC LIMIT 1
       ) artifact ON true
       LEFT JOIN LATERAL (
         SELECT current.status
           FROM source_processing_runs current
          WHERE current.source_candidate_id = source.id
          ORDER BY current.created_at DESC LIMIT 1
       ) run ON true
      WHERE ($1::uuid[] IS NULL OR source.id = ANY($1::uuid[]))
        AND source.status <> 'rejected'`,
    [sourceIds],
  )
  return result.rows[0] ?? {
    sources: 0,
    eligible: 0,
    unavailable: 0,
    active_runs: 0,
    estimated_bytes: 0
  }
}

export async function processNextReprocessItem(
  database: Database,
): Promise<boolean> {
  return withTransaction(database, async (client) => {
    const schedulerLock = await client.query<{ acquired: boolean }>(
      `SELECT pg_try_advisory_xact_lock(
         hashtext('clideck-mcp:pipeline-scheduler')
       ) AS acquired`,
    )
    if (!schedulerLock.rows[0]?.acquired) return false
    await client.query(
      `UPDATE intake_job_sources item
          SET status = 'completed', updated_at = now()
        FROM source_processing_runs run
       WHERE item.status = 'running'
         AND run.source_candidate_id = item.source_candidate_id
         AND run.processing_version = item.processing_version
         AND run.status = 'completed'`,
    )
    await client.query(
      `UPDATE intake_job_sources item
          SET status = CASE WHEN run.status = 'unavailable'
                            THEN 'unavailable' ELSE 'failed' END,
              result = result || jsonb_build_object(
                'failure_code', run.failure_code,
                'failure_message', run.failure_message
              ),
              updated_at = now()
         FROM source_processing_runs run
        WHERE item.status = 'running'
          AND run.source_candidate_id = item.source_candidate_id
          AND run.processing_version = item.processing_version
          AND run.status IN ('failed', 'unavailable', 'cancelled')`,
    )
    await client.query(
      `UPDATE intake_jobs job
          SET status = CASE WHEN EXISTS (
                SELECT 1 FROM intake_job_sources item
                 WHERE item.intake_job_id = job.id AND item.status = 'failed'
              ) THEN 'completed_with_errors' ELSE 'completed' END,
              completed_at = now(), updated_at = now()
        WHERE job.status IN ('queued', 'running')
          AND EXISTS (
            SELECT 1 FROM intake_job_sources item
             WHERE item.intake_job_id = job.id
          )
          AND NOT EXISTS (
            SELECT 1 FROM intake_job_sources item
             WHERE item.intake_job_id = job.id
               AND item.status IN ('queued', 'running')
          )`,
    )
    const capacity = await client.query<{
      count: number
      max_active_sources: number
    }>(
      `SELECT settings.max_active_sources,
              (
                SELECT count(*)::int
                  FROM intake_job_sources item
                  JOIN intake_jobs job ON job.id = item.intake_job_id
                 WHERE job.job_type = 'reprocess'
                   AND job.status IN ('queued', 'running')
                   AND item.status = 'running'
              ) AS count
         FROM pipeline_settings settings
        WHERE settings.singleton`,
    )
    const maxActiveSources = capacity.rows[0]?.max_active_sources ?? 1

    // Keep reprocessing incremental and aligned with the scheduler's real
    // source capacity instead of a separate hard-coded executor count.
    if ((capacity.rows[0]?.count ?? 0) >= maxActiveSources) return false
    const selected = await client.query<{
      job_id: string
      source_id: string
      processing_version: string
      source_kind: SourceKind
      canonical_url: string | null
      source_ref: string
      title: string
      document_type: string
      artifact_id: string | null
      artifact_status: string | null
    }>(
      `SELECT item.intake_job_id AS job_id,
              source.id AS source_id, item.processing_version,
              source.source_kind, source.canonical_url, source.source_ref,
              source.title, source.document_type,
              artifact.id AS artifact_id, artifact.status AS artifact_status
         FROM intake_job_sources item
         JOIN intake_jobs job ON job.id = item.intake_job_id
         JOIN source_candidates source ON source.id = item.source_candidate_id
         LEFT JOIN LATERAL (
           SELECT current.id, current.status
             FROM source_artifacts current
            WHERE current.source_candidate_id = source.id
            ORDER BY current.acquired_at DESC LIMIT 1
         ) artifact ON true
        WHERE job.job_type = 'reprocess'
          AND job.status IN ('queued', 'running')
          AND item.status = 'queued'
        ORDER BY job.created_at, item.created_at
        LIMIT 1
        FOR UPDATE OF item SKIP LOCKED`,
    )
    const item = selected.rows[0]
    if (!item) return false
    if (item.artifact_id && item.artifact_status !== 'purged') {
      const runId = await createProcessingRun(
        client,
        item.source_id,
        item.artifact_id,
        item.processing_version,
      )
      await client.query(
        `UPDATE source_candidates
            SET status = 'acquired', updated_at = now()
          WHERE id = $1`,
        [item.source_id],
      )
      await queueUploadedSource(client, {
        sourceId: item.source_id,
        processingRunId: runId,
        locator: item.canonical_url ?? `https://mcp.clideck.com/sources/${item.source_ref}`,
        title: item.title,
        documentType: item.document_type
      })
    } else if (
      item.canonical_url &&
      (item.source_kind === 'official_web' || item.source_kind === 'admin_web')
    ) {
      await client.query(
        `UPDATE source_candidates SET status = 'approved', updated_at = now()
          WHERE id = $1`,
        [item.source_id],
      )
      await client.query(
        `INSERT INTO pipeline_tasks (
           task_type, stage, status, priority, source_candidate_id,
           dedupe_key, payload
         ) VALUES (
           'source_acquisition', 'acquire', 'queued', 65, $1, $2,
           jsonb_build_object(
             'source_id', $1::text, 'canonical_url', $3::text,
             'source_ref', $4::text, 'source_kind', $5::text,
             'document_type', $6::text, 'title', $7::text,
             'processing_version', $8::text
           )
         ) ON CONFLICT DO NOTHING`,
        [
          item.source_id,
          `reprocess:${item.processing_version}:acquire`,
          item.canonical_url,
          item.source_ref,
          item.source_kind,
          item.document_type,
          item.title,
          item.processing_version
        ],
      )
    } else {
      await client.query(
        `UPDATE intake_job_sources SET status = 'unavailable', updated_at = now()
          WHERE intake_job_id = $1 AND source_candidate_id = $2`,
        [item.job_id, item.source_id],
      )
      return true
    }
    await client.query(
      `UPDATE intake_job_sources SET status = 'running', updated_at = now()
        WHERE intake_job_id = $1 AND source_candidate_id = $2`,
      [item.job_id, item.source_id],
    )
    await client.query(
      `UPDATE intake_jobs
          SET status = 'running', started_at = coalesce(started_at, now()),
              configuration = configuration ||
                '{"current_stage":"reprocess"}'::jsonb,
              updated_at = now()
        WHERE id = $1`,
      [item.job_id],
    )
    return true
  })
}
