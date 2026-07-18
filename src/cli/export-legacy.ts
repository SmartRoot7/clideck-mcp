import pg, { type QueryResult } from 'pg'
import { z } from 'zod'

const { Client } = pg

const environmentSchema = z.object({
  LEGACY_DATABASE_URL: z.string().url().startsWith('postgresql://'),
  LEGACY_EXPORT_BATCH_SIZE: z.coerce.number().int().min(100).max(5_000).default(1_000)
})
const environment = environmentSchema.parse(process.env)
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
  risk_level: string
  lifecycle_status: string
  introduced_version: string | null
  deprecated_version: string | null
  removed_version: string | null
  replacement_command: string | null
  source_trust: string
  confidence: number
  review_quality_score: number | null
  review_reason: string | null
  legacy_provenance: unknown
  published_at: string
}

let exported = 0
let cursor: string | null = null

try {
  await client.connect()
  await client.query('BEGIN TRANSACTION READ ONLY')
  await client.query(`SET LOCAL lock_timeout = '2s'`)
  await client.query(`SET LOCAL idle_in_transaction_session_timeout = '60s'`)

  for (;;) {
    const result: QueryResult<LegacyExportRow> = await client.query<LegacyExportRow>(
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
         "riskLevel"::text AS risk_level,
         "lifecycleStatus"::text AS lifecycle_status,
         "introducedVersion" AS introduced_version,
         "deprecatedVersion" AS deprecated_version,
         "removedVersion" AS removed_version,
         "replacementCommand" AS replacement_command,
         "sourceTrust"::text AS source_trust,
         "confidence",
         "reviewQualityScore" AS review_quality_score,
         "reviewReason" AS review_reason,
         "sourceReferences" AS legacy_provenance,
         "publishedAt" AS published_at
       FROM "CliKnowledgePublishedItem"
       WHERE "publicationStatus" = 'published'
         AND ($1::text IS NULL OR "id" > $1)
       ORDER BY "id"
       LIMIT $2`,
      [cursor, environment.LEGACY_EXPORT_BATCH_SIZE],
    )

    if (result.rows.length === 0) break
    for (const row of result.rows) {
      process.stdout.write(`${JSON.stringify({
        schema_version: 1,
        record_type: 'legacy_published_knowledge',
        ...row
      })}\n`)
      exported += 1
      cursor = row.id
    }
  }
  await client.query('COMMIT')
  process.stderr.write(`Exported ${exported} legacy knowledge records\n`)
} catch (error) {
  await client.query('ROLLBACK').catch(() => undefined)
  process.stderr.write(
    `Legacy export failed: ${error instanceof Error ? error.message : 'unknown error'}\n`,
  )
  process.exitCode = 1
} finally {
  await client.end()
}
