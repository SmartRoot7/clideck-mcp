import { readdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { createCliRuntime } from './runtime.js'

const { database, logger } = createCliRuntime()
const migrationDirectory = resolve(process.cwd(), 'migrations')

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
