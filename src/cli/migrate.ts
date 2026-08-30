import { readdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { createCliRuntime } from './runtime.js'

const migrationDirectory = resolve(process.cwd(), 'migrations')
// Production migrations can backfill and index multi-gigabyte datasets. Keep
// the normal API/worker query timeout strict, but give each versioned,
// advisory-locked migration enough time to finish atomically.
const migrationQueryTimeoutMs = 30 * 60 * 1_000
const { database, logger } = createCliRuntime('default', {
  queryTimeoutMs: migrationQueryTimeoutMs
})

try {
  const client = await database.connect()
  try {
    await client.query(`SELECT pg_advisory_lock(hashtext('clideck-mcp-migrations'))`)
    await client.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         version text PRIMARY KEY,
         applied_at timestamptz NOT NULL DEFAULT now()
       )`,
    )

    const appliedResult = await client.query<{ version: string }>(
      'SELECT version FROM schema_migrations',
    )
    const applied = new Set(appliedResult.rows.map((row) => row.version))
    const migrations = (await readdir(migrationDirectory))
      .filter((name) => /^\d+_[a-z0-9_-]+\.sql$/.test(name))
      .sort()

    for (const migration of migrations) {
      if (applied.has(migration)) continue
      if (migration === '034_knowledge_pipeline_v2.sql') {
        // pg's client-side query timeout cannot cancel a multi-statement SQL
        // script. An older deploy could therefore stop waiting while the
        // explicit BEGIN/COMMIT in 034 continued and committed, leaving only
        // schema_migrations unrecorded. Recover solely when a strict end-state
        // fingerprint (including the final grants) proves the whole migration
        // completed; partial application still fails normally.
        const recovered = await client.query<{ complete: boolean }>(
          `SELECT
             to_regclass('source_processing_runs') IS NOT NULL
             AND to_regclass('knowledge_candidate_occurrences') IS NOT NULL
             AND to_regclass('pipeline_quality_profiles') IS NOT NULL
             AND to_regclass('pipeline_quality_checks') IS NOT NULL
             AND to_regclass('intake_jobs') IS NOT NULL
             AND to_regclass('intake_job_sources') IS NOT NULL
             AND to_regclass('source_uploads') IS NOT NULL
             AND to_regclass('source_collection_pages') IS NOT NULL
             AND EXISTS (
               SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public'
                  AND table_name = 'source_candidates'
                  AND column_name = 'source_kind'
             )
             AND EXISTS (
               SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public'
                  AND table_name = 'release_changes'
                  AND column_name = 'change_kind'
             )
             AND EXISTS (
               SELECT 1 FROM pg_constraint
                WHERE conname = 'release_changes_shape_check'
             )
             AND EXISTS (
               SELECT 1 FROM information_schema.role_table_grants
                WHERE table_schema = 'public'
                  AND table_name = 'source_collection_pages'
                  AND grantee = 'clideck_mcp_admin'
                  AND privilege_type = 'UPDATE'
             ) AS complete`,
        )
        if (recovered.rows[0]?.complete) {
          await client.query(
            `INSERT INTO schema_migrations (version) VALUES ($1)
             ON CONFLICT DO NOTHING`,
            [migration],
          )
          logger.warn(
            { migration },
            'Recovered migration ledger from complete schema fingerprint',
          )
          continue
        }
      }
      logger.info({ migration }, 'Applying migration')
      const sql = await readFile(resolve(migrationDirectory, migration), 'utf8')
      await client.query(sql)
      await client.query(
        'INSERT INTO schema_migrations (version) VALUES ($1)',
        [migration],
      )
    }
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally {
    try {
      await client.query(
        `SELECT pg_advisory_unlock(hashtext('clideck-mcp-migrations'))`,
      )
    } finally {
      client.release()
    }
  }
  logger.info('Database migrations complete')
} catch (error) {
  logger.fatal({ err: error }, 'Database migration failed')
  process.exitCode = 1
} finally {
  await database.end()
}
