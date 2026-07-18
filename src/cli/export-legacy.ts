import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { once } from 'node:events'
import { finished } from 'node:stream/promises'

import pg, { type QueryResult } from 'pg'
import { z } from 'zod'

const { Client } = pg

const environmentSchema = z.object({
  LEGACY_DATABASE_URL: z.string().url().startsWith('postgresql://'),
  LEGACY_EXPORT_PATH: z.string().min(1),
  LEGACY_MANIFEST_PATH: z.string().min(1),
  LEGACY_EXPORT_BATCH_SIZE: z.coerce.number().int()
    .min(100).max(5_000).default(1_000)
})
const environment = environmentSchema.parse(process.env)
const exportPath = resolve(environment.LEGACY_EXPORT_PATH)
const manifestPath = resolve(environment.LEGACY_MANIFEST_PATH)
const client = new Client({
  connectionString: environment.LEGACY_DATABASE_URL,
  application_name: 'clideck-mcp-read-only-legacy-export',
  query_timeout: 30_000,
  statement_timeout: 30_000
})

type LegacyExportRow = {
  id: string
  item_type: string
  canonical_name: string | null
  command: string | null
  command_pattern: string | null
  aliases: string[]
  vendor: string | null
  product_family: string | null
  product: string | null
  platform: string | null
  operating_system: string | null
  os_version_min: string | null
  os_version_max: string | null
  cli_mode: string | null
  privilege_requirement: string | null
  task_tags: string[]
  purpose: string | null
  short_explanation: string | null
  usage_guidance: string | null
  example_usage: string | null
  example_output: string | null
  parser_hints: unknown
  output_schema: unknown
  risk_level: string
  lifecycle_status: string
  introduced_version: string | null
  deprecated_version: string | null
  removed_version: string | null
  replacement_command: string | null
  source_trust: string
  confidence: number
  review_decision: string | null
  review_quality_score: number | null
  review_reason: string | null
  reviewed_at: string | null
  payload_json: unknown
  search_text: string | null
  legacy_provenance: unknown
  published_at: string
}

function increment(
  breakdown: Record<string, number>,
  value: string | null,
): void {
  const key = value?.trim() || '(missing)'
  breakdown[key] = (breakdown[key] ?? 0) + 1
}

async function writeLine(
  stream: ReturnType<typeof createWriteStream>,
  value: string,
): Promise<void> {
  if (!stream.write(value)) await once(stream, 'drain')
}

let exported = 0
let cursor: string | null = null
const hash = createHash('sha256')
const breakdown = {
  item_type: {} as Record<string, number>,
  vendor: {} as Record<string, number>,
  operating_system: {} as Record<string, number>,
  risk_level: {} as Record<string, number>,
  source_trust: {} as Record<string, number>,
  lifecycle_status: {} as Record<string, number>
}
let missingOs = 0
let missingVersionScope = 0

await mkdir(dirname(exportPath), { recursive: true, mode: 0o750 })
await mkdir(dirname(manifestPath), { recursive: true, mode: 0o750 })
const output = createWriteStream(exportPath, {
  encoding: 'utf8',
  flags: 'wx',
  mode: 0o600
})

try {
  await client.connect()
  await client.query('BEGIN TRANSACTION READ ONLY')
  await client.query(`SET LOCAL lock_timeout = '2s'`)
  await client.query(`SET LOCAL idle_in_transaction_session_timeout = '60s'`)

  for (;;) {
    const result: QueryResult<LegacyExportRow> =
      await client.query<LegacyExportRow>(
        `SELECT
           "id" AS id,
           "itemType"::text AS item_type,
           "canonicalName" AS canonical_name,
           "command",
           "commandPattern" AS command_pattern,
           coalesce("aliases", '{}') AS aliases,
           "vendor",
           "productFamily" AS product_family,
           "product",
           "platform",
           "operatingSystem" AS operating_system,
           "osVersionMin" AS os_version_min,
           "osVersionMax" AS os_version_max,
           "cliMode" AS cli_mode,
           "privilegeRequirement" AS privilege_requirement,
           coalesce("taskTags", '{}') AS task_tags,
           "purpose",
           "shortExplanation" AS short_explanation,
           "usageGuidance" AS usage_guidance,
           "exampleUsage" AS example_usage,
           "exampleOutput" AS example_output,
           "parserHints" AS parser_hints,
           "outputSchema" AS output_schema,
           "riskLevel"::text AS risk_level,
           "lifecycleStatus"::text AS lifecycle_status,
           "introducedVersion" AS introduced_version,
           "deprecatedVersion" AS deprecated_version,
           "removedVersion" AS removed_version,
           "replacementCommand" AS replacement_command,
           "sourceTrust"::text AS source_trust,
           "confidence",
           "reviewDecision" AS review_decision,
           "reviewQualityScore" AS review_quality_score,
           "reviewReason" AS review_reason,
           "reviewedAt" AS reviewed_at,
           "payloadJson" AS payload_json,
           "searchText" AS search_text,
           "sourceReferences" AS legacy_provenance,
           "publishedAt" AS published_at
         FROM "CliKnowledgePublishedItem"
         WHERE "publicationStatus"::text = 'published'
           AND ($1::text IS NULL OR "id" > $1::text)
         ORDER BY "id"
         LIMIT $2`,
        [cursor, environment.LEGACY_EXPORT_BATCH_SIZE],
      )

    if (result.rows.length === 0) break
    for (const row of result.rows) {
      const line = `${JSON.stringify({
        schema_version: 2,
        record_type: 'legacy_published_knowledge',
        ...row
      })}\n`
      await writeLine(output, line)
      hash.update(line, 'utf8')
      exported += 1
      cursor = row.id
      increment(breakdown.item_type, row.item_type)
      increment(breakdown.vendor, row.vendor)
      increment(breakdown.operating_system, row.operating_system)
      increment(breakdown.risk_level, row.risk_level)
      increment(breakdown.source_trust, row.source_trust)
      increment(breakdown.lifecycle_status, row.lifecycle_status)
      if (!row.operating_system) missingOs += 1
      if (!row.os_version_min && !row.os_version_max) {
        missingVersionScope += 1
      }
    }
  }
  await client.query('COMMIT')
  output.end()
  await finished(output)

  const manifest = {
    schema_version: 2,
    record_type: 'clideck_legacy_export_manifest',
    exported_at: new Date().toISOString(),
    record_count: exported,
    file_hash: `sha256:${hash.digest('hex')}`,
    missing_operating_system: missingOs,
    missing_version_scope: missingVersionScope,
    breakdown
  }
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), {
    encoding: 'utf8',
    mode: 0o600,
    flag: 'wx'
  })
  process.stderr.write(
    `Exported ${exported} legacy knowledge records with a SHA-256 manifest\n`,
  )
} catch (error) {
  output.destroy()
  await client.query('ROLLBACK').catch(() => undefined)
  process.stderr.write(
    `Legacy export failed: ${
      error instanceof Error ? error.message : 'unknown error'
    }\n`,
  )
  process.exitCode = 1
} finally {
  await client.end()
}
