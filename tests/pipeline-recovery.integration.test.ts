import { randomUUID } from 'node:crypto'
import pg from 'pg'
import type { Database } from '../src/db.js'
import { ensurePipelineWork, reconcileExpiredPipelineLeases } from '../src/domain/pipeline.js'
import { expandNextSourceCollection } from '../src/domain/pipeline-worker.js'
import { createLogger } from '../src/logger.js'
import { createTestConfig, integrationDatabaseUrl } from './helpers.js'

const suite = integrationDatabaseUrl ? describe : describe.skip
suite('pipeline incident recovery', () => {
  const database = new pg.Pool({ connectionString: integrationDatabaseUrl, max: 8 })
  const ids: string[] = []
  afterAll(async () => {
    await database.query('DELETE FROM pipeline_events WHERE pipeline_task_id=ANY($1::uuid[])', [ids])
    await database.query('DELETE FROM agent_runs WHERE pipeline_task_id=ANY($1::uuid[])', [ids])
    await database.query('DELETE FROM pipeline_tasks WHERE id=ANY($1::uuid[])', [ids])
    await database.end()
  })
  async function task(attempts = 2, fresh = false) {
    const id = randomUUID()
    ids.push(id)
    await database.query(`INSERT INTO pipeline_tasks
      (id,task_type,stage,status,dedupe_key,payload,attempts,claim_owner,lease_until,heartbeat_at)
      VALUES ($1::uuid,'source_discovery','discover','running',($1::uuid)::text,'{}',$2,'pipeline-executor-01',
        now()+CASE WHEN $3 THEN interval '2 minutes' ELSE interval '-12 hours' END,now())`, [id,attempts,fresh])
    await database.query(`INSERT INTO agent_runs(pipeline_task_id,model,reasoning_effort,status)
      VALUES ($1,'gpt-6-luna','low','running')`, [id])
    return id
  }
  it('commits expired lease recovery even when the following scheduler transaction fails', async () => {
    const expired = await task()
    const exhausted = await task(5)
    const live = await task(1,true)
    const failingScheduler = {
      connect: async () => {
        const client = await database.connect()
        return {
          query: (sql: string | pg.QueryConfig, values?: unknown[]) => {
            if (typeof sql === 'string' && sql.includes("hashtext('clideck-mcp:pipeline-scheduler')")) {
              throw new Error('FIXTURE_PREPARATION_FAILED')
            }
            return client.query(sql,values)
          },
          release: client.release.bind(client)
        }
      }
    } as unknown as Database
    await expect(ensurePipelineWork(failingScheduler)).rejects.toThrow('FIXTURE_PREPARATION_FAILED')
    const rows = (await database.query('SELECT id,status,claim_owner,lease_until,attempts,failure_code FROM pipeline_tasks WHERE id=ANY($1::uuid[])',[[expired,exhausted,live]])).rows
    expect(rows.find(row=>row.id===expired)).toMatchObject({status:'queued',claim_owner:null,lease_until:null,attempts:2})
    expect(rows.find(row=>row.id===exhausted)).toMatchObject({status:'failed',failure_code:'LEASE_ATTEMPTS_EXHAUSTED',attempts:5})
    expect(rows.find(row=>row.id===live)).toMatchObject({status:'running',claim_owner:'pipeline-executor-01',attempts:1})
    expect((await database.query('SELECT status,error_code FROM agent_runs WHERE pipeline_task_id=$1',[expired])).rows[0])
      .toMatchObject({status:'failed',error_code:'LEASE_EXPIRED'})
  })
  it('recovers free expired tasks while the scheduler and another expired task are locked', async () => {
    const locked = await task()
    const free = await task()
    const owner = await database.connect()
    try {
      await owner.query('BEGIN')
      await owner.query("SELECT pg_advisory_xact_lock(hashtext('clideck-mcp:pipeline-scheduler'))")
      await owner.query('SELECT id FROM pipeline_tasks WHERE id=$1 FOR UPDATE',[locked])
      await reconcileExpiredPipelineLeases(database)
      expect((await database.query('SELECT status FROM pipeline_tasks WHERE id=$1',[free])).rows[0]?.status).toBe('queued')
      expect((await database.query('SELECT status FROM pipeline_tasks WHERE id=$1',[locked])).rows[0]?.status).toBe('running')
    } finally { await owner.query('ROLLBACK'); owner.release() }
    await reconcileExpiredPipelineLeases(database)
    expect((await database.query('SELECT status FROM pipeline_tasks WHERE id=$1',[locked])).rows[0]?.status).toBe('queued')
  })
  it('completes a full legacy collection budget and permits a new bounded scan with lifetime counters intact', async () => {
    const client = await database.connect()
    await client.query('BEGIN')
    const db = {
      query: client.query.bind(client),
      connect: async () => ({query: (sql: string | pg.QueryConfig,values?:unknown[]) =>
        typeof sql==='string' && /^(BEGIN|COMMIT|ROLLBACK)$/.test(sql.trim())
          ? Promise.resolve({rows:[]}) : client.query(sql,values),release:()=>undefined})
    } as unknown as Database
    const logger = createLogger(createTestConfig())
    const url = `https://docs.kernel.org/${randomUUID()}`
    const fetchDocument = vi.fn(async (requestedUrl:string) => ({finalUrl:requestedUrl,mediaType:'text/html',body:Buffer.from('<p>Bounded official collection fixture</p>')}))
    try {
      await client.query("UPDATE source_collections SET status='paused'")
      const collection = (await client.query(`INSERT INTO source_collections
        (canonical_url,vendor_domain,collection_type,link_limit,pages_seen,cursor)
        VALUES ($1,'docs.kernel.org','manual_root',1,1,$2::jsonb) RETURNING id`,[url,JSON.stringify({queue:[{url,depth:0}]})])).rows[0]
      expect(await expandNextSourceCollection(db,logger,fetchDocument)).toBe(true)
      expect(fetchDocument).not.toHaveBeenCalled()
      const closed = (await client.query('SELECT cursor,pages_seen,next_scan_at>now() AS scheduled FROM source_collections WHERE id=$1',[collection.id])).rows[0]
      expect(closed).toMatchObject({cursor:{queue:[],scan_pages_seen:0},pages_seen:1,scheduled:true})
      expect(await expandNextSourceCollection(db,logger,fetchDocument)).toBe(false)
      // A later scan has its own budget; it must not stop at the lifetime total.
      await client.query('UPDATE source_collections SET next_scan_at=now(),cursor=$2::jsonb WHERE id=$1',
        [collection.id,JSON.stringify({queue:[{url,depth:0}],scan_pages_seen:0})])
      expect(await expandNextSourceCollection(db,logger,fetchDocument)).toBe(true)
      expect(fetchDocument).toHaveBeenCalledOnce()
      expect((await client.query('SELECT cursor,pages_seen FROM source_collections WHERE id=$1',[collection.id])).rows[0])
        .toMatchObject({cursor:{queue:[],scan_pages_seen:0},pages_seen:2})
    } finally { await client.query('ROLLBACK'); client.release() }
  })
})
