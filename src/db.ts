import pg from 'pg'

import type { AppConfig } from './config.js'
import type { Logger } from './logger.js'

const { Pool } = pg

export type Database = pg.Pool
export type DatabaseClient = pg.PoolClient

export function createDatabase(
  config: AppConfig,
  logger: Logger,
  databaseUrl = config.databaseUrl,
): Database {
  const pool = new Pool({
    connectionString: databaseUrl,
    max: config.databaseMaxConnections,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    query_timeout: 10_000,
    application_name: 'clideck-mcp',
    ssl:
      config.databaseSslMode === 'verify-full'
        ? { rejectUnauthorized: true }
        : false
  })

  pool.on('error', (error) => {
    logger.error({ err: error }, 'Unexpected PostgreSQL pool error')
  })

  return pool
}

export async function withTransaction<T>(
  database: Database,
  operation: (client: DatabaseClient) => Promise<T>,
): Promise<T> {
  const client = await database.connect()
  try {
    await client.query('BEGIN')
    const result = await operation(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}
