import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import pg from 'pg'
import { lockCandidateRows } from '../src/domain/publication.js'
import { integrationDatabaseUrl } from './helpers.js'

const suite = integrationDatabaseUrl ? describe : describe.skip

suite('overlapping publication and fidelity batches', () => {
  const pool = new pg.Pool({ connectionString: integrationDatabaseUrl, max: 3 })
  afterAll(() => pool.end())

  it('finishes opposite-order batches while an unrelated candidate stays writable', async () => {
    const origin = randomUUID()
    const [first, second, unrelated] = [randomUUID(), randomUUID(), randomUUID()].sort() as [string, string, string]
    const left = await pool.connect()
    const right = await pool.connect()
    const observer = await pool.connect()
    let pending: Promise<unknown> | undefined
    try {
      await observer.query(`INSERT INTO pipeline_tasks(id,task_type,stage,status,dedupe_key,payload)
        VALUES ($1::uuid,'fragment_analysis','analyze','completed',($1::uuid)::text,'{}')`, [origin])
      await observer.query(`INSERT INTO knowledge_candidates
        (id,pipeline_task_id,stable_key,payload,content_hash,status,dangerous,confidence,quality_score)
        SELECT id,$1,'fixture.lock.'||id,'{}','sha256:'||repeat('a',64),'verified',false,.98,.98
        FROM unnest($2::uuid[]) id`, [origin, [first, second, unrelated]])
      for (const [client, role] of [[left, 'clideck_mcp_worker'], [right, 'clideck_mcp_researcher']] as const) {
        await client.query('BEGIN')
        await client.query("SET LOCAL deadlock_timeout='100ms'")
        await client.query("SET LOCAL statement_timeout='3s'")
        await client.query(`SET LOCAL ROLE ${role}`)
      }
      // A publication already holds the first row. An audit arriving in reverse
      // payload order must wait there without taking the publication's next row.
      await left.query('SELECT id FROM knowledge_candidates WHERE id=$1 FOR UPDATE', [first])
      const pid = (await right.query<{ pid: number }>('SELECT pg_backend_pid() pid')).rows[0]!.pid
      pending = lockCandidateRows(right, [second, first]).then(
        () => null,
        error => error,
      )
      let waiting = false
      for (let attempt = 0; attempt < 50; attempt += 1) {
        const activity = await observer.query<{ waiting: boolean }>(
          "SELECT wait_event_type='Lock' AS waiting FROM pg_stat_activity WHERE pid=$1", [pid])
        if (activity.rows[0]?.waiting) { waiting = true; break }
        await delay(20)
      }
      expect(waiting).toBe(true)
      await observer.query('SELECT id FROM knowledge_candidates WHERE id=$1 FOR UPDATE NOWAIT', [unrelated])
      await lockCandidateRows(left, [first, second])
      await left.query("UPDATE knowledge_candidates SET status='published' WHERE id=ANY($1::uuid[])", [[first, second]])
      await left.query('COMMIT')
      expect(await pending).toBeNull()
      await right.query("UPDATE knowledge_candidates SET fidelity_status='passed' WHERE id=ANY($1::uuid[])", [[first, second]])
      await right.query('COMMIT')
      const rows = await observer.query<{ status: string; fidelity_status: string }>(
        'SELECT status,fidelity_status FROM knowledge_candidates WHERE id=ANY($1::uuid[])', [[first, second]])
      expect(rows.rows).toHaveLength(2)
      expect(rows.rows.every(row => row.status === 'published' && row.fidelity_status === 'passed')).toBe(true)
    } finally {
      await left.query('ROLLBACK')
      await pending
      await right.query('ROLLBACK')
      await observer.query('DELETE FROM knowledge_candidates WHERE pipeline_task_id=$1', [origin])
      await observer.query('DELETE FROM pipeline_tasks WHERE id=$1', [origin])
      left.release(); right.release(); observer.release()
    }
  })
})
