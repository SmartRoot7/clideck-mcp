import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { describe, expect, it, beforeAll, afterAll, vi } from 'vitest'

import { createDatabase, withTransaction, type DatabaseClient } from '../src/db.js'
import { createLogger } from '../src/logger.js'
import { createTestConfig, integrationDatabaseUrl } from './helpers.js'

const suite = integrationDatabaseUrl ? describe : describe.skip

suite('checked-out PostgreSQL connection recovery', () => {
  const config = createTestConfig({ databaseMaxConnections: 2 })
  const logger = createLogger(config)
  const errors = vi.spyOn(logger, 'error')
  const database = createDatabase(config, logger)
  const administrator = new pg.Pool({ connectionString: integrationDatabaseUrl })
  const table = `connection_recovery_${randomUUID().replaceAll('-', '')}`

  beforeAll(async () => {
    await database.query(`CREATE TABLE ${table} (value integer NOT NULL)`)
  })

  afterAll(async () => {
    await database.query(`DROP TABLE IF EXISTS ${table}`)
    await database.end()
    await administrator.end()
    errors.mockRestore()
  })

  async function disconnect(client: DatabaseClient) {
    const result = await client.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')
    // Listen only for end: an error listener here would hide the original crash.
    const ended = new Promise<void>((resolve) => client.once('end', resolve))
    await administrator.query('SELECT pg_terminate_backend($1)', [result.rows[0]!.pid])
    await ended
  }

  it('logs a disconnected checked-out client without an unhandled error and replaces it', async () => {
    errors.mockClear()
    const client = await database.connect()
    try {
      await disconnect(client)
      await expect(client.query('SELECT 1')).rejects.toThrow(/connection|queryable/i)
      expect(errors).toHaveBeenCalledWith(
        { err: expect.any(Error) }, 'Unexpected PostgreSQL client error',
      )
    } finally {
      client.release(true)
    }
    expect((await database.query('SELECT 1 AS healthy')).rows[0]?.healthy).toBe(1)
  })

  it('rejects a disconnected transaction, preserves rollback, and permits later work', async () => {
    await expect(withTransaction(database, async (client) => {
      await client.query(`INSERT INTO ${table} VALUES (1)`)
      await disconnect(client)
      return 'must not commit'
    })).rejects.toThrow(/connection|queryable/i)

    expect((await database.query(`SELECT * FROM ${table}`)).rows).toEqual([])
    await withTransaction(database, (client) => client.query(`INSERT INTO ${table} VALUES (2)`))
    expect((await database.query(`SELECT value FROM ${table}`)).rows).toEqual([{ value: 2 }])
  })
})
