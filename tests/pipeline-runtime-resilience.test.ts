import { describe, expect, it, vi } from 'vitest'

import type { AppConfig } from '../src/config.js'
import type { Database, DatabaseClient } from '../src/db.js'
import { withTransaction } from '../src/db.js'
import { heartbeatMechanicalPipelineTaskWithClient } from '../src/domain/pipeline.js'

describe('pipeline runtime resilience', () => {
  it('renews a mechanical lease using the original token and bounded duration', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ id: 'task-id' }] })
    const client = { query } as unknown as DatabaseClient

    await expect(heartbeatMechanicalPipelineTaskWithClient(
      client,
      { taskLeaseSeconds: 120 } as AppConfig,
      '11111111-1111-4111-8111-111111111111',
      'lease-token-with-enough-entropy-123456',
    )).resolves.toBe(true)

    expect(query).toHaveBeenCalledOnce()
    expect(query.mock.calls[0]?.[0]).toContain("status = 'running'")
    expect(query.mock.calls[0]?.[0]).toContain('lease_until > now()')
    expect(query.mock.calls[0]?.[1]?.[0]).toBe(
      '11111111-1111-4111-8111-111111111111',
    )
    expect(query.mock.calls[0]?.[1]?.[2]).toEqual(expect.any(String))
  })

  it('destroys a connection when rollback also times out', async () => {
    const original = new Error('Query read timeout')
    const rollback = new Error('Rollback read timeout')
    const release = vi.fn()
    const query = vi.fn(async (sql: string) => {
      if (sql === 'BEGIN') return { rows: [] }
      if (sql === 'ROLLBACK') throw rollback
      throw original
    })
    const client = { query, release } as unknown as DatabaseClient
    const database = {
      connect: vi.fn().mockResolvedValue(client)
    } as unknown as Database

    await expect(withTransaction(
      database,
      (transaction) => transaction.query('SELECT slow_query()'),
    )).rejects.toBe(original)

    expect(release).toHaveBeenCalledWith(rollback)
  })
})
