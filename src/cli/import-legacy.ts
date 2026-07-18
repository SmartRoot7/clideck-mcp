import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createInterface } from 'node:readline'
import { resolve } from 'node:path'

import { z } from 'zod'

import type { DatabaseClient } from '../db.js'
import { withTransaction } from '../db.js'
import { sha256Label } from '../crypto.js'
import { publishKnowledgeBatch } from '../domain/publication.js'
import {
  escalateKnowledgeRisk,
  type KnowledgeRiskLevel
} from '../domain/risk.js'
import { normalizeVendorVersion } from '../version.js'
import { createCliRuntime } from './runtime.js'

const environmentSchema = z.object({
  LEGACY_JSONL_PATH: z.string().min(1),
  LEGACY_MANIFEST_PATH: z.string().min(1),
  LEGACY_SOURCE_LABEL: z.string().trim().min(1).max(160)
    .default('clideck-legacy-published'),
  LEGACY_IMPORT_BATCH_SIZE: z.coerce.number().int()
    .min(25).max(1_000).default(250),
  LEGACY_EXPECTED_RECORDS: z.coerce.number().int()
    .positive().default(56_747),
  LEGACY_EXPECTED_ACTIVE_TOTAL: z.coerce.number().int()
    .positive().default(56_798),
  LEGACY_ACTIVATE: z.enum(['true', 'false']).default('false')
    .transform((value) => value === 'true')
})

const manifestSchema = z.object({
  schema_version: z.literal(2),
  record_type: z.literal('clideck_legacy_export_manifest'),
  record_count: z.number().int().positive(),
  file_hash: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  breakdown: z.record(z.string(), z.unknown())
}).passthrough()

const legacyRecordSchema = z.object({
  schema_version: z.literal(2),
  record_type: z.literal('legacy_published_knowledge'),
  id: z.string().min(1).max(200),
  item_type: z.string().min(1).max(80),
  canonical_name: z.string().nullable(),
  command: z.string().nullable(),
  command_pattern: z.string().nullable(),
  aliases: z.array(z.string()),
  vendor: z.string().min(1),
  product_family: z.string().nullable(),
  product: z.string().nullable(),
  platform: z.string().nullable(),
  operating_system: z.string().nullable(),
  os_version_min: z.string().nullable(),
  os_version_max: z.string().nullable(),
  cli_mode: z.string().nullable(),
  privilege_requirement: z.string().nullable(),
  task_tags: z.array(z.string()),
  purpose: z.string().nullable(),
  short_explanation: z.string().nullable(),
  usage_guidance: z.string().nullable(),
  example_usage: z.string().nullable(),
  example_output: z.string().nullable(),
  parser_hints: z.unknown().nullable(),
  output_schema: z.unknown().nullable(),
  risk_level: z.string(),
  lifecycle_status: z.string(),
  introduced_version: z.string().nullable(),
  deprecated_version: z.string().nullable(),
  removed_version: z.string().nullable(),
  replacement_command: z.string().nullable(),
  source_trust: z.string(),
  confidence: z.number().min(0).max(1),
  review_decision: z.string().nullable(),
  review_quality_score: z.number().min(0).max(10).nullable(),
  review_reason: z.string().nullable(),
  reviewed_at: z.string().nullable(),
  payload_json: z.unknown().nullable(),
  search_text: z.string().nullable(),
  legacy_provenance: z.unknown().nullable().optional(),
  published_at: z.string()
})

type LegacyRecord = z.infer<typeof legacyRecordSchema>

const allowedRisks = new Set([
  'safe_read_only',
  'changes_config',
  'credential_sensitive',
  'service_disruptive',
  'data_loss',
  'storage_wipe',
  'firmware_change',
  'boot_change',
  'factory_reset',
  'unknown'
])

function clamp(value: string | null | undefined, max: number): string | null {
  const normalized = value?.replace(/\u0000/g, '').trim()
  return normalized ? normalized.slice(0, max) : null
}

function slug(value: string, fallback: string): string {
  const normalized = value
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63)
  if (normalized.length >= 2) return normalized
  return fallback
}

function normalizedVersion(value: string | null): number[] | null {
  if (!value) return null
  try {
    return normalizeVendorVersion(value)
  } catch {
    return null
  }
}

function kindForItemType(
  value: string,
): 'command' | 'workflow' | 'diagnostic' | 'concept' {
  if (value === 'command') return 'command'
  if (value === 'runbook') return 'workflow'
  if (value === 'warning') return 'diagnostic'
  return 'concept'
}

function safeDate(value: string | null, fallback: string): string {
  if (!value) return fallback
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? fallback
    : date.toISOString()
}

function transform(record: LegacyRecord) {
  const vendorName = clamp(record.vendor, 120) ?? 'Unknown vendor'
  const vendorSlug = slug(vendorName, 'legacy-vendor')
  const operatingSystemName = clamp(record.operating_system, 120)
  const operatingSystemSlug = operatingSystemName
    ? slug(operatingSystemName, 'legacy-os')
    : null
  const platformName = clamp(
    record.product ?? record.platform ?? record.product_family,
    160,
  )
  const platformSlug = platformName
    ? slug(platformName, 'legacy-platform')
    : null
  const legacyKeyHash = createHash('sha256')
    .update(record.id, 'utf8')
    .digest('hex')
    .slice(0, 32)
  const stableKey = `legacy.${vendorSlug}.${legacyKeyHash}`.slice(0, 160)
  const title = (
    clamp(
      record.canonical_name ??
      record.command ??
      record.purpose ??
      `${vendorName} ${record.item_type}`,
      240,
    ) ?? 'Legacy network knowledge'
  )
  const summaryParts = [
    record.short_explanation,
    record.purpose,
    record.usage_guidance
  ].flatMap((value) => {
    const bounded = clamp(value, 2_000)
    return bounded ? [bounded] : []
  })
  const summary = (
    summaryParts.join('\n\n') ||
    clamp(record.search_text, 4_000) ||
    title
  ).slice(0, 4_000)
  const questionPatterns = [
    record.canonical_name,
    record.command,
    record.command_pattern,
    ...record.aliases,
    ...record.task_tags,
    record.purpose
  ].flatMap((value) => {
    const bounded = clamp(value, 300)
    return bounded && bounded.length >= 3 ? [bounded] : []
  }).filter((value, index, all) => all.indexOf(value) === index)
    .slice(0, 20)
  if (questionPatterns.length === 0) questionPatterns.push(title)

  const originalRiskLevel: KnowledgeRiskLevel =
    allowedRisks.has(record.risk_level)
      ? record.risk_level as KnowledgeRiskLevel
      : 'unknown'
  const riskLevel = escalateKnowledgeRisk(
    originalRiskLevel,
    [
      record.command,
      record.usage_guidance,
      record.example_usage
    ].flatMap((value) => value ? [value] : []),
  )
  const publishedAt = safeDate(record.published_at, new Date().toISOString())
  const lastVerifiedAt = safeDate(record.reviewed_at, publishedAt)
  const minVersion = record.os_version_min
  const maxVersion = record.os_version_max
  const minNormalized = normalizedVersion(minVersion)
  const maxNormalized = normalizedVersion(maxVersion)
  const usableMin = minVersion && minNormalized ? minVersion : null
  const usableMax = maxVersion && maxNormalized ? maxVersion : null
  const payloadHash = sha256Label(JSON.stringify(record))

  return {
    legacy_key: record.id,
    stable_key: stableKey,
    kind: kindForItemType(record.item_type),
    vendor_slug: vendorSlug,
    vendor_name: vendorName,
    operating_system_slug: operatingSystemSlug,
    operating_system_name: operatingSystemName,
    platform_slug: platformSlug,
    platform_name: platformName,
    version_min: usableMin,
    version_max: usableMax,
    version_normalized_min: usableMin ? minNormalized : null,
    version_normalized_max: usableMax ? maxNormalized : null,
    title,
    summary,
    question_patterns: questionPatterns,
    cli_mode: clamp(record.cli_mode, 120),
    command_text: clamp(record.command, 2_000),
    procedure_steps: [
      record.usage_guidance,
      record.example_usage
    ].flatMap((value) => {
      const bounded = clamp(value, 1_000)
      return bounded ? [bounded] : []
    }),
    prerequisites: [
      record.privilege_requirement
        ? `Required privilege: ${record.privilege_requirement}`
        : null
    ].flatMap((value) => value ? [value.slice(0, 1_000)] : []),
    risks: [
      `Legacy risk classification: ${originalRiskLevel}.`,
      riskLevel !== originalRiskLevel
        ? `CliDeck deterministic guard enforced risk level ${riskLevel}.`
        : null,
      record.lifecycle_status !== 'active'
        ? `Lifecycle status: ${record.lifecycle_status}.`
        : null
    ].flatMap((value) => value ? [value] : []),
    verification_steps: [
      'Verify the command output and resulting device state before relying on this migrated knowledge.'
    ],
    rollback_steps: record.replacement_command
      ? [`Use the documented replacement command: ${
        record.replacement_command.slice(0, 900)
      }`]
      : [],
    limitations: [
      operatingSystemName
        ? null
        : 'Operating system was not specified in the legacy record; applicability is vendor-level.',
      usableMin || usableMax
        ? null
        : 'Version scope was not specified in the legacy record; applicability is unbounded.',
      'Migrated from the established CliDeck knowledge base with conservative risk enforcement.'
    ].flatMap((value) => value ? [value] : []),
    dangerous: riskLevel !== 'safe_read_only',
    risk_level: riskLevel,
    confidence: record.confidence,
    quality_score: record.review_quality_score === null
      ? record.confidence
      : record.review_quality_score / 10,
    original_quality_score: record.review_quality_score,
    confidence_reason: (
      clamp(record.review_reason, 1_800) ??
      `Legacy confidence ${record.confidence.toFixed(3)} and source trust ${record.source_trust} were preserved during migration.`
    ),
    last_verified_at: lastVerifiedAt.slice(0, 10),
    source_trust: record.source_trust,
    lifecycle_status: record.lifecycle_status,
    item_type: record.item_type,
    original_risk_level: originalRiskLevel,
    published_at: publishedAt,
    provenance: record.legacy_provenance ?? null,
    payload_hash: payloadHash,
    raw_payload: record
  }
}

const inputCte = `
WITH input AS MATERIALIZED (
  SELECT *
  FROM jsonb_to_recordset($1::jsonb) AS x(
    legacy_key text,
    stable_key text,
    kind text,
    vendor_slug text,
    vendor_name text,
    operating_system_slug text,
    operating_system_name text,
    platform_slug text,
    platform_name text,
    version_min text,
    version_max text,
    version_normalized_min integer[],
    version_normalized_max integer[],
    title text,
    summary text,
    question_patterns text[],
    cli_mode text,
    command_text text,
    procedure_steps jsonb,
    prerequisites jsonb,
    risks jsonb,
    verification_steps jsonb,
    rollback_steps jsonb,
    limitations jsonb,
    dangerous boolean,
    risk_level text,
    original_risk_level text,
    confidence numeric,
    quality_score numeric,
    confidence_reason text,
    last_verified_at date,
    source_trust text,
    lifecycle_status text,
    item_type text,
    original_quality_score numeric,
    published_at timestamptz,
    provenance jsonb,
    payload_hash text,
    raw_payload jsonb
  )
)`

async function importBatch(
  client: DatabaseClient,
  importRunId: string,
  batch: ReturnType<typeof transform>[],
): Promise<void> {
  const json = JSON.stringify(batch)
  await client.query(
    `${inputCte}
     INSERT INTO vendors (slug, display_name)
     SELECT DISTINCT vendor_slug, vendor_name FROM input
     ON CONFLICT (slug) DO NOTHING`,
    [json],
  )
  await client.query(
    `${inputCte}
     INSERT INTO operating_systems (
       vendor_id, slug, display_name, version_scheme
     )
     SELECT DISTINCT v.id, i.operating_system_slug,
       i.operating_system_name, 'vendor'
     FROM input i
     JOIN vendors v ON v.slug = i.vendor_slug
     WHERE i.operating_system_slug IS NOT NULL
     ON CONFLICT (vendor_id, slug) DO NOTHING`,
    [json],
  )
  await client.query(
    `${inputCte}
     INSERT INTO platforms (vendor_id, slug, display_name)
     SELECT DISTINCT v.id, i.platform_slug, i.platform_name
     FROM input i
     JOIN vendors v ON v.slug = i.vendor_slug
     WHERE i.platform_slug IS NOT NULL
     ON CONFLICT (vendor_id, slug) DO NOTHING`,
    [json],
  )
  await client.query(
    `${inputCte}
     INSERT INTO knowledge_items (stable_key, kind)
     SELECT stable_key, kind FROM input
     ON CONFLICT (stable_key) DO NOTHING`,
    [json],
  )
  await client.query(
    `${inputCte}
     INSERT INTO knowledge_revisions (
       knowledge_item_id,
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
       created_by,
       created_at
     )
     SELECT
       ki.id,
       1,
       'validated',
       v.id,
       p.id,
       os.id,
       i.version_min,
       i.version_max,
       i.version_normalized_min,
       i.version_normalized_max,
       i.title,
       i.summary,
       i.question_patterns,
       i.cli_mode,
       i.command_text,
       i.procedure_steps,
       i.prerequisites,
       i.risks,
       i.verification_steps,
       i.rollback_steps,
       i.limitations,
       i.dangerous,
       i.risk_level,
       i.confidence,
       i.quality_score,
       i.confidence_reason,
       i.last_verified_at,
       'legacy_import',
       i.published_at
     FROM input i
     JOIN knowledge_items ki ON ki.stable_key = i.stable_key
     JOIN vendors v ON v.slug = i.vendor_slug
     LEFT JOIN operating_systems os
       ON os.vendor_id = v.id AND os.slug = i.operating_system_slug
     LEFT JOIN platforms p
       ON p.vendor_id = v.id AND p.slug = i.platform_slug
     ON CONFLICT (knowledge_item_id, revision_number) DO NOTHING`,
    [json],
  )
  await client.query(
    `${inputCte}
     INSERT INTO knowledge_public_trust (
       revision_id,
       validation_level,
       independent_confirmations,
       confidence_explanation,
       next_review_at
     )
     SELECT
       kr.id,
       'legacy_migrated',
       1,
       'Migrated from established CliDeck knowledge with preserved confidence and conservative risk enforcement.',
       i.last_verified_at + 180
     FROM input i
     JOIN knowledge_items ki ON ki.stable_key = i.stable_key
     JOIN knowledge_revisions kr
       ON kr.knowledge_item_id = ki.id AND kr.revision_number = 1
     ON CONFLICT (revision_id) DO NOTHING`,
    [json],
  )
  await client.query(
    `${inputCte}
     INSERT INTO legacy_revision_metadata (
       revision_id,
       legacy_key,
       legacy_item_type,
       source_trust,
       lifecycle_status,
       original_risk_level,
       original_confidence,
       original_quality_score,
       published_at,
       provenance,
       payload_hash
     )
     SELECT
       kr.id,
       i.legacy_key,
       i.item_type,
       i.source_trust,
       i.lifecycle_status,
       i.risk_level,
       i.confidence,
       i.original_quality_score,
       i.published_at,
       i.provenance,
       i.payload_hash
     FROM input i
     JOIN knowledge_items ki ON ki.stable_key = i.stable_key
     JOIN knowledge_revisions kr
       ON kr.knowledge_item_id = ki.id AND kr.revision_number = 1
     ON CONFLICT (legacy_key) DO NOTHING`,
    [json],
  )
  await client.query(
    `${inputCte}
     INSERT INTO import_items (
       import_run_id,
       legacy_key,
       payload,
       trust_level,
       status,
       content_hash,
       knowledge_item_id,
       revision_id,
       transformed_at
     )
     SELECT
       $2,
       i.legacy_key,
       i.raw_payload,
       CASE
         WHEN i.source_trust IN ('official_vendor', 'official_project')
           THEN 'verified'
         WHEN i.source_trust = 'trusted_community' THEN 'low'
         ELSE 'unknown'
       END,
       'accepted',
       i.payload_hash,
       ki.id,
       kr.id,
       now()
     FROM input i
     JOIN knowledge_items ki ON ki.stable_key = i.stable_key
     JOIN knowledge_revisions kr
       ON kr.knowledge_item_id = ki.id AND kr.revision_number = 1
     ON CONFLICT (import_run_id, legacy_key)
       WHERE legacy_key IS NOT NULL
     DO UPDATE SET
       knowledge_item_id = excluded.knowledge_item_id,
       revision_id = excluded.revision_id,
       transformed_at = excluded.transformed_at`,
    [json, importRunId],
  )
}

async function hashFile(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk as Buffer)
  }
  return `sha256:${hash.digest('hex')}`
}

const environment = environmentSchema.parse(process.env)
const jsonlPath = resolve(environment.LEGACY_JSONL_PATH)
const manifest = manifestSchema.parse(
  JSON.parse(await readFile(resolve(environment.LEGACY_MANIFEST_PATH), 'utf8')),
)
const actualHash = await hashFile(jsonlPath)
if (
  actualHash !== manifest.file_hash ||
  manifest.record_count !== environment.LEGACY_EXPECTED_RECORDS
) {
  throw new Error('LEGACY_MANIFEST_MISMATCH')
}

const { database, logger } = createCliRuntime()
let importRunId: string | undefined
let seen = 0

try {
  const existing = await database.query<{ id: string }>(
    `SELECT id
     FROM import_runs
     WHERE manifest_hash = $1
     ORDER BY started_at DESC
     LIMIT 1`,
    [manifest.file_hash],
  )
  if (existing.rows[0]) {
    importRunId = existing.rows[0].id
    await database.query(
      `UPDATE import_runs
          SET status = 'running',
              error_message = NULL,
              completed_at = NULL
        WHERE id = $1`,
      [importRunId],
    )
  } else {
    const run = await database.query<{ id: string }>(
      `INSERT INTO import_runs (
         source_label, status, manifest_hash
       )
       VALUES ($1, 'running', $2)
       RETURNING id`,
      [environment.LEGACY_SOURCE_LABEL, manifest.file_hash],
    )
    importRunId = run.rows[0]!.id
  }

  const lines = createInterface({
    input: createReadStream(jsonlPath, { encoding: 'utf8' }),
    crlfDelay: Number.POSITIVE_INFINITY
  })
  let batch: ReturnType<typeof transform>[] = []
  for await (const line of lines) {
    if (!line.trim()) continue
    const record = legacyRecordSchema.parse(JSON.parse(line))
    batch.push(transform(record))
    seen += 1
    if (batch.length >= environment.LEGACY_IMPORT_BATCH_SIZE) {
      const current = batch
      batch = []
      await withTransaction(database, (client) =>
        importBatch(client, importRunId!, current),
      )
      await database.query(
        `UPDATE import_runs
            SET records_seen = $2,
                records_imported = (
                  SELECT count(*)::int
                  FROM import_items
                  WHERE import_run_id = $1 AND status = 'accepted'
                ),
                last_legacy_key = $3
          WHERE id = $1`,
        [importRunId, seen, current.at(-1)!.legacy_key],
      )
    }
  }
  if (batch.length > 0) {
    await withTransaction(database, (client) =>
      importBatch(client, importRunId!, batch),
    )
  }

  const reconciliation = await database.query<{
    imported: number
    revisions: number
  }>(
    `SELECT
       (SELECT count(*)::int FROM import_items
        WHERE import_run_id = $1 AND status = 'accepted') AS imported,
       (SELECT count(*)::int FROM legacy_revision_metadata) AS revisions`,
    [importRunId],
  )
  const imported = reconciliation.rows[0]?.imported ?? 0
  const revisions = reconciliation.rows[0]?.revisions ?? 0
  if (
    seen !== environment.LEGACY_EXPECTED_RECORDS ||
    imported !== environment.LEGACY_EXPECTED_RECORDS ||
    revisions !== environment.LEGACY_EXPECTED_RECORDS
  ) {
    throw new Error(
      `LEGACY_RECONCILIATION_FAILED:${seen}:${imported}:${revisions}`,
    )
  }

  let releaseSequence: number | null = null
  if (environment.LEGACY_ACTIVATE) {
    const publication = await withTransaction(database, async (client) => {
      const current = await client.query<{ count: number }>(
        `SELECT count(*)::int AS count
         FROM release_items
         WHERE release_id = (
           SELECT release_id FROM active_release WHERE singleton
         )`,
      )
      const expectedExisting =
        environment.LEGACY_EXPECTED_ACTIVE_TOTAL -
        environment.LEGACY_EXPECTED_RECORDS
      if ((current.rows[0]?.count ?? 0) !== expectedExisting) {
        throw new Error('LEGACY_ACTIVE_BASE_COUNT_MISMATCH')
      }
      const legacy = await client.query<{
        item_id: string
        revision_id: string
      }>(
        `SELECT kr.knowledge_item_id AS item_id, kr.id AS revision_id
         FROM knowledge_revisions kr
         JOIN legacy_revision_metadata lrm ON lrm.revision_id = kr.id
         ORDER BY lrm.legacy_key`,
      )
      const release = await publishKnowledgeBatch(
        client,
        legacy.rows.map((row) => ({
          itemId: row.item_id,
          revisionId: row.revision_id
        })),
        `Atomic legacy import of ${legacy.rows.length} CliDeck knowledge records`,
        'clideck-mcp-legacy-import',
      )
      const active = await client.query<{ count: number }>(
        `SELECT count(*)::int AS count
         FROM release_items
         WHERE release_id = $1`,
        [release.releaseId],
      )
      if (
        (active.rows[0]?.count ?? 0) !==
        environment.LEGACY_EXPECTED_ACTIVE_TOTAL
      ) {
        throw new Error('LEGACY_ACTIVE_TOTAL_MISMATCH')
      }
      await client.query(
        `UPDATE import_items
            SET published_at = now()
          WHERE import_run_id = $1
            AND status = 'accepted'`,
        [importRunId],
      )
      return release
    })
    releaseSequence = publication.sequence
  }

  await database.query(
    `UPDATE import_runs
        SET status = 'completed',
            records_seen = $2,
            records_quarantined = 0,
            records_imported = $2,
            records_published = CASE WHEN $3 THEN $2 ELSE 0 END,
            records_failed = 0,
            completed_at = now(),
            last_legacy_key = (
              SELECT max(legacy_key)
              FROM import_items
              WHERE import_run_id = $1
            )
      WHERE id = $1`,
    [importRunId, imported, environment.LEGACY_ACTIVATE],
  )
  logger.info(
    {
      importRunId,
      imported,
      activated: environment.LEGACY_ACTIVATE,
      releaseSequence
    },
    'Legacy import reconciled successfully',
  )
} catch (error) {
  if (importRunId) {
    await database.query(
      `UPDATE import_runs
          SET status = 'failed',
              records_seen = $2,
              completed_at = now(),
              error_message = $3
        WHERE id = $1`,
      [
        importRunId,
        seen,
        error instanceof Error ? error.message.slice(0, 1_000) : 'unknown error'
      ],
    ).catch(() => undefined)
  }
  logger.fatal({ err: error }, 'Legacy import failed')
  process.exitCode = 1
} finally {
  await database.end()
}
