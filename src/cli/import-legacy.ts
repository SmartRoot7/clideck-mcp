import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'

import { z } from 'zod'

import { createCliRuntime } from './runtime.js'

const environmentSchema = z.object({
  LEGACY_JSONL_PATH: z.string().min(1),
  LEGACY_SOURCE_LABEL: z.string().trim().min(1).max(160).default('clideck-legacy-jsonl')
})

const legacyRecordSchema = z.object({
  schema_version: z.literal(1),
  record_type: z.literal('legacy_published_knowledge'),
  id: z.string().min(1).max(200),
  item_type: z.string().min(1).max(80),
  canonical_name: z.string().nullable(),
  command: z.string().nullable(),
  vendor: z.string().nullable(),
  platform: z.string().nullable(),
  operating_system: z.string().nullable(),
  os_version_min: z.string().nullable(),
  os_version_max: z.string().nullable(),
  source_trust: z.string().min(1).max(80),
  confidence: z.number().min(0).max(1),
  legacy_provenance: z.unknown().nullable().optional()
}).passthrough()

const environment = environmentSchema.parse(process.env)
const { database, logger } = createCliRuntime()
let importRunId: string | undefined
let seen = 0
let quarantined = 0

try {
  const run = await database.query<{ id: string }>(
    `INSERT INTO import_runs (source_label, status)
     VALUES ($1, 'running')
     RETURNING id`,
    [environment.LEGACY_SOURCE_LABEL],
  )
  importRunId = run.rows[0]!.id

  const lines = createInterface({
    input: createReadStream(environment.LEGACY_JSONL_PATH, {
      encoding: 'utf8'
    }),
    crlfDelay: Number.POSITIVE_INFINITY
  })

  for await (const line of lines) {
    if (!line.trim()) continue
    seen += 1
    let payload: unknown
    let rejectionReason: string | null = null
    try {
      payload = legacyRecordSchema.parse(JSON.parse(line))
      const record = payload as z.infer<typeof legacyRecordSchema>
      if (!record.vendor || !record.operating_system) {
        rejectionReason = 'missing_vendor_or_operating_system'
      } else if (!record.os_version_min && !record.os_version_max) {
        rejectionReason = 'missing_version_scope'
      } else if (record.source_trust === 'unknown') {
        rejectionReason = 'unknown_source_trust'
      }
    } catch {
      payload = { invalid_line_number: seen }
      rejectionReason = 'invalid_jsonl_record'
    }

    await database.query(
      `INSERT INTO import_items (
         import_run_id,
         legacy_key,
         payload,
         trust_level,
         status,
         rejection_reason
       )
       VALUES (
         $1,
         $2,
         $3::jsonb,
         CASE
           WHEN $4 = 'verified' THEN 'verified'
           WHEN $4 = 'low' THEN 'low'
           ELSE 'unknown'
         END,
         'quarantine',
         $5
       )`,
      [
        importRunId,
        typeof payload === 'object' &&
        payload !== null &&
        'id' in payload &&
        typeof payload.id === 'string'
          ? payload.id
          : null,
        JSON.stringify(payload),
        typeof payload === 'object' &&
        payload !== null &&
        'source_trust' in payload
          ? String(payload.source_trust)
          : 'unknown',
        rejectionReason
      ],
    )
    quarantined += 1
  }

  await database.query(
    `UPDATE import_runs
        SET status = 'completed',
            records_seen = $2,
            records_quarantined = $3,
            completed_at = now()
      WHERE id = $1`,
    [importRunId, seen, quarantined],
  )
  logger.info(
    { importRunId, seen, quarantined },
    'Legacy import completed in quarantine',
  )
} catch (error) {
  if (importRunId) {
    await database.query(
      `UPDATE import_runs
          SET status = 'failed',
              records_seen = $2,
              records_quarantined = $3,
              completed_at = now(),
              error_message = $4
        WHERE id = $1`,
      [
        importRunId,
        seen,
        quarantined,
        error instanceof Error ? error.message.slice(0, 1_000) : 'unknown error'
      ],
    ).catch(() => undefined)
  }
  logger.fatal({ err: error }, 'Legacy import failed')
  process.exitCode = 1
} finally {
  await database.end()
}
