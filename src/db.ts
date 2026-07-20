import pg from 'pg'
import { setTimeout as delay } from 'node:timers/promises'

import type { AppConfig } from './config.js'
import type { Logger } from './logger.js'

const { Pool } = pg

export type Database = pg.Pool
export type DatabaseClient = pg.PoolClient

const transientDatabaseCodes = new Set([
  '08000',
  '08003',
  '08006',
  '08001',
  '08004',
  '40001',
  '40P01',
  '53300',
  '57P01',
  '57P02',
  '57P03'
])

export function isTransientDatabaseError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const candidate = error as { code?: unknown; message?: unknown }
  if (
    typeof candidate.code === 'string' &&
    transientDatabaseCodes.has(candidate.code)
  ) {
    return true
  }
  return (
    typeof candidate.message === 'string' &&
    /connection (?:terminated|closed|reset)|timeout|ECONNRESET|server closed the connection/i
      .test(candidate.message)
  )
}

export async function withTransientDatabaseRetry<T>(
  operation: () => Promise<T>,
  attempts = 2,
): Promise<T> {
  let lastError: unknown
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await operation()
    } catch (error) {
      lastError = error
      if (!isTransientDatabaseError(error) || attempt + 1 >= attempts) {
        throw error
      }
      await delay(40 + attempt * 80)
    }
  }
  throw lastError
}

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
