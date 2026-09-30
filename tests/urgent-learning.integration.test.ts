import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { executionProtocolVersion } from '@clideck/admin-contracts'
import type { Database } from '../src/db.js'
import { sha256Label } from '../src/crypto.js'
import {
  getKnowledgeLearningProgress, queueUnknownKnowledgeDemand,
  recoverUnqueuedKnowledgeDemands, reportKnowledgeGap
} from '../src/domain/mcp-observability.js'
import { claimPipelineTask, ensurePipelineWork } from '../src/domain/pipeline.js'
import { createTestConfig, integrationDatabaseUrl } from './helpers.js'

const suite = integrationDatabaseUrl ? describe : describe.skip
suite('urgent learning reliability', () => {
  const pool = new pg.Pool({ connectionString: integrationDatabaseUrl, max: 24 })
  const config = createTestConfig()
  afterAll(() => pool.end())
  const context = { vendor: 'Cisco', operating_system: 'IOS XE' }
  const question = () => `Inspect MACsec learning fixture ${randomUUID()}`
  async function transaction(run: (db: Database, client: pg.PoolClient) => Promise<void>) {
    const client = await pool.connect()
    await client.query('BEGIN')
    const db = {
      query: client.query.bind(client),
      connect: async () => ({ query: (sql: string | pg.QueryConfig, values?: unknown[]) =>
        typeof sql === 'string' && /^(BEGIN|COMMIT|ROLLBACK)$/.test(sql.trim())
          ? Promise.resolve({ rows: [] }) : client.query(sql, values), release: () => undefined })
    } as unknown as Database
    try { await run(db,client) } finally { await client.query('ROLLBACK'); client.release() }
  }
  it('records 20 simultaneous questions without dropping tasks and collapses duplicate submissions', async () => {
    const requests = Array.from({ length: 20 }, () => {
      const vendor = `learning-fixture-${randomUUID()}`
      return { question: question(), context: { vendor, operating_system: 'IOS XE' },
        output: { unknown: true, context: { vendor, vendor_slug: vendor,
          operating_system: 'IOS XE', operating_system_slug: 'ios-xe' } } }
    })
    const ids = (await Promise.all(requests.map((input) => queueUnknownKnowledgeDemand(pool,
      'query_network_knowledge',input,input.output)))).filter((id): id is string => !!id)
    try {
      expect(ids).toHaveLength(20)
      expect(new Set(ids).size).toBe(20)
      const repeated = await Promise.all(Array.from({ length: 20 }, () =>
        queueUnknownKnowledgeDemand(pool,'query_network_knowledge',requests[0],requests[0]!.output)))
      expect(new Set(repeated)).toEqual(new Set([ids[0]]))
      const active = await pool.query(`SELECT count(*)::int AS count FROM pipeline_tasks
        WHERE knowledge_demand_id=ANY($1::uuid[]) AND task_type='demand_diagnosis'
          AND status IN ('queued','claimed','running')`,[ids])
      expect(active.rows[0]!.count).toBe(20)
    } finally {
      await pool.query("UPDATE pipeline_tasks SET status='cancelled' WHERE knowledge_demand_id=ANY($1::uuid[])",[ids])
      await pool.query("UPDATE coverage_targets SET status='paused' WHERE id IN (SELECT coverage_target_id FROM knowledge_demands WHERE id=ANY($1::uuid[]))",[ids])
      await pool.query("UPDATE knowledge_demands SET status='unresolved',last_error_code='CONTEXT_REQUIRED',diagnosis_status='completed' WHERE id=ANY($1::uuid[])",[ids])
    }
  })
  it('keeps unknown questions with missing context visible without inventing a device', async () => {
    await transaction(async (db,client) => {
      const id = await queueUnknownKnowledgeDemand(db,'query_network_knowledge', { question: question(), context: {} }, { unknown: true })
      expect(id).toBeTruthy()
      await client.query('SET LOCAL ROLE clideck_mcp_api')
      const progress = await getKnowledgeLearningProgress(db,id!)
      expect(progress).toMatchObject({ status: 'unresolved', needs_context: true, queued_tasks: 0, active_tasks: 0 })
    })
  })
  it.each(['clideck_mcp_researcher','clideck_mcp_worker'])('recovers a durable intake failure with the actual %s permissions', async (role) => {
    await transaction(async (db,client) => {
      const request = { question: question(), context }
      const log = await client.query(`INSERT INTO mcp_request_logs
        (request_id,actor_kind,tool_name,request_payload,response_payload,question_preview,response_preview,outcome,duration_ms)
        VALUES ($1,'anonymous','query_network_knowledge',$2,'{"unknown":true}', $3,'unknown','unknown',1) RETURNING id`,
      [randomUUID(),request,request.question])
      await client.query(`SET LOCAL ROLE ${role}`)
      await recoverUnqueuedKnowledgeDemands(client)
      const stored = await client.query('SELECT knowledge_demand_id,learning_recovery_checked_at FROM mcp_request_logs WHERE id=$1',[log.rows[0]!.id])
      expect(stored.rows[0]?.knowledge_demand_id).toBeTruthy()
      expect(stored.rows[0]?.learning_recovery_checked_at).toBeTruthy()
    })
  })
  it('repairs queued diagnosis without a task and chooses it before background work', async () => {
    await transaction(async (db,client) => {
      await client.query("UPDATE pipeline_tasks SET status='cancelled' WHERE status IN ('queued','claimed','running')")
      await client.query("UPDATE agent_runs SET status='cancelled',completed_at=now() WHERE status='running'")
      await client.query('DELETE FROM pipeline_model_circuits')
      await client.query('UPDATE pipeline_settings SET enabled=true,max_concurrent_ai_runs=8 WHERE singleton')
      const id = await queueUnknownKnowledgeDemand(db,'query_network_knowledge', { question: question(), context }, { unknown: true })
      await client.query("UPDATE pipeline_tasks SET status='cancelled' WHERE knowledge_demand_id=$1",[id])
      const background = await client.query(`INSERT INTO pipeline_tasks(task_type,stage,priority,dedupe_key,payload)
        VALUES ('fragment_analysis','analyze',200,$1,'{}') RETURNING id`,[randomUUID()])
      await ensurePipelineWork(db)
      const repaired = await client.query("SELECT id FROM pipeline_tasks WHERE knowledge_demand_id=$1 AND task_type='demand_diagnosis' AND status='queued'",[id])
      expect(repaired.rows).toHaveLength(1)
      await client.query('UPDATE pipeline_tasks SET priority=200 WHERE id=$1',[background.rows[0]!.id])
      // Hold the scheduler lock only through this isolated transaction.
      const claim = await claimPipelineTask(db,config,'luna-1','test:urgent',executionProtocolVersion)
      expect(claim['pipeline_task_id']).toBe(repaired.rows[0]!.id)
      expect((await client.query('SELECT status FROM pipeline_tasks WHERE id=$1',[background.rows[0]!.id])).rows[0]!.status).toBe('queued')
    })
  })
  it('reopens feedback without quarantining knowledge and deduplicates repeated reports', async () => {
    await transaction(async (db,client) => {
      const input = { question: question(), context, reason: 'The answer covers a different protocol.', revision_refs: [randomUUID()] }
      await client.query('SET LOCAL ROLE clideck_mcp_api')
      const first = await reportKnowledgeGap(db,input)
      const second = await reportKnowledgeGap(db,input)
      expect(first?.id).toBe(second?.id)
      expect(second?.status).toBe('diagnosing')
      const stored = await client.query('SELECT context FROM knowledge_demands WHERE id=$1',[first!.id])
      expect(stored.rows[0]!.context.reported_revision_refs).toEqual(input.revision_refs)
      const tasks = await client.query("SELECT status FROM pipeline_tasks WHERE knowledge_demand_id=$1 AND task_type='demand_diagnosis' AND status IN ('queued','claimed','running')",[first!.id])
      expect(tasks.rows).toHaveLength(1)
    })
  })
  it.each(['background','urgent_discovery'])('materializes and claims urgent analysis despite future retries and a full %s queue', async (queuedKind) => {
    await transaction(async (db,client) => {
      await client.query("UPDATE pipeline_tasks SET status='cancelled' WHERE status IN ('queued','claimed','running')")
      await client.query("UPDATE knowledge_demands SET status='published'")
      await client.query('DELETE FROM pipeline_model_circuits')
      await client.query('UPDATE pipeline_settings SET enabled=true,max_concurrent_ai_runs=8 WHERE singleton')
      for (let i=0;i<8;i++) {
        const retryId = await queueUnknownKnowledgeDemand(db,'query_network_knowledge',{ question: question(), context },{unknown:true})
        await client.query("UPDATE pipeline_tasks SET available_at=now()+interval '1 hour' WHERE knowledge_demand_id=$1",[retryId])
        if (queuedKind === 'urgent_discovery') {
          await client.query(`INSERT INTO pipeline_tasks(task_type,stage,dedupe_key,payload,knowledge_demand_id,queue_class)
            VALUES ('source_discovery','discover',$1,'{}',$2,'demand')`,[randomUUID(),retryId])
        }
        await client.query(`INSERT INTO pipeline_tasks(task_type,stage,dedupe_key,payload)
          VALUES ('fragment_analysis','analyze',$1,'{}')`,[randomUUID()])
      }
      const id = await queueUnknownKnowledgeDemand(db,'query_network_knowledge',{question:question(),context},{unknown:true})
      await client.query("UPDATE pipeline_tasks SET status='cancelled' WHERE knowledge_demand_id=$1",[id])
      await client.query("UPDATE knowledge_demands SET diagnosis_status='completed',status='processing' WHERE id=$1",[id])
      const source = (await client.query(`INSERT INTO source_candidates(coverage_target_id,canonical_url,document_type,title,status,discovered_by,knowledge_demand_id)
        SELECT coverage_target_id,$2,'command_reference','MACsec fixture','prepared','test',id FROM knowledge_demands WHERE id=$1 RETURNING id`,[id,`https://www.cisco.com/${randomUUID()}`])).rows[0]!
      const text='MACsec interface inspection: show macsec interface.'
      const hash=sha256Label(randomUUID())
      const artifact=(await client.query(`INSERT INTO source_artifacts(source_candidate_id,media_type,byte_size,content_hash,storage_path,status)
        VALUES ($1,'text/plain',$2,$3,'/tmp/urgent-fixture.txt','chunked') RETURNING id`,[source.id,text.length,hash])).rows[0]!
      await client.query(`INSERT INTO source_fragments(source_artifact_id,ordinal,content,content_hash)
        VALUES ($1,0,$2,$3)`,[artifact.id,text,hash])
      await ensurePipelineWork(db)
      const tasks=await client.query("SELECT task_type FROM pipeline_tasks WHERE knowledge_demand_id=$1 AND status='queued'",[id])
      expect(tasks.rows).toContainEqual({task_type:'fragment_analysis'})
      const claim=await claimPipelineTask(db,config,'luna-1',`test:${queuedKind}`,executionProtocolVersion)
      expect(claim['task_type']).toBe('fragment_analysis')
      expect((await client.query('SELECT knowledge_demand_id FROM pipeline_tasks WHERE id=$1',[claim['pipeline_task_id']])).rows[0]!.knowledge_demand_id).toBe(id)
    })
  })
  it('starts a ready user question despite an exhausted topic with a future eligibility date', async () => {
    await transaction(async (db,client) => {
      await client.query("UPDATE pipeline_tasks SET status='cancelled' WHERE status IN ('queued','claimed','running')")
      await client.query("UPDATE knowledge_demands SET status='published'")
      await client.query('DELETE FROM pipeline_model_circuits')
      await client.query('UPDATE pipeline_settings SET enabled=true,max_concurrent_ai_runs=8 WHERE singleton')
      const id = await queueUnknownKnowledgeDemand(db,'query_network_knowledge',{
        question: question(), context: { vendor: `topic-fixture-${randomUUID()}`, operating_system: 'IOS XE' }
      },{unknown:true})
      await client.query("UPDATE pipeline_tasks SET status='cancelled' WHERE knowledge_demand_id=$1",[id])
      await client.query("UPDATE knowledge_demands SET status='queued',diagnosis_status='completed',next_retry_at=now() WHERE id=$1",[id])
      const topic=(await client.query(`INSERT INTO demand_topics(topic_key,topic_slug,scope,state,next_eligible_at)
        VALUES ($1,'macsec','{}','exhausted',now()+interval '7 days') RETURNING id`,[sha256Label(randomUUID())])).rows[0]!
      await client.query(`INSERT INTO knowledge_demand_topic_memberships(knowledge_demand_id,demand_topic_id)
        VALUES ($1,$2)`,[id,topic.id])
      await ensurePipelineWork(db)
      const work=await client.query("SELECT task_type FROM pipeline_tasks WHERE knowledge_demand_id=$1 AND status='queued'",[id])
      expect(work.rows).toEqual([{task_type:'source_discovery'}])
      expect((await client.query('SELECT state FROM demand_topics WHERE id=$1',[topic.id])).rows[0]!.state).toBe('active')
    })
  })
  it('audits terminal sources using the original run even when a newer run exists', async () => {
    await transaction(async (db,client) => {
      await client.query("UPDATE pipeline_tasks SET status='cancelled' WHERE status IN ('queued','claimed','running')")
      await client.query("UPDATE knowledge_demands SET status='published'")
      await client.query('DELETE FROM pipeline_model_circuits')
      await client.query('UPDATE pipeline_settings SET enabled=true,max_concurrent_ai_runs=8 WHERE singleton')
      // Background queue capacity must not hide a user's terminal-source audit.
      for (let i=0;i<8;i++) await client.query(`INSERT INTO pipeline_tasks(task_type,stage,dedupe_key,payload)
        VALUES ('fragment_analysis','analyze',$1,'{}')`,[randomUUID()])
      const demandId=await queueUnknownKnowledgeDemand(db,'query_network_knowledge',{question:question(),context},{unknown:true})
      await client.query("UPDATE pipeline_tasks SET status='cancelled' WHERE knowledge_demand_id=$1",[demandId])
      await client.query("UPDATE knowledge_demands SET status='processing',diagnosis_status='completed' WHERE id=$1",[demandId])
      const target = (await client.query(`INSERT INTO coverage_targets(vendor_slug,operating_system_slug,document_role,status)
        VALUES ('cisco','ios-xe','commands','paused') ON CONFLICT DO NOTHING RETURNING id`)).rows[0]
        ?? (await client.query("SELECT id FROM coverage_targets WHERE vendor_slug='cisco' AND operating_system_slug='ios-xe' LIMIT 1")).rows[0]
      const source = (await client.query(`INSERT INTO source_candidates(coverage_target_id,canonical_url,document_type,title,status,discovered_by)
        VALUES ($1,$2,'command_reference','Terminal fidelity fixture','completed','test') RETURNING id`,[target.id,`https://www.cisco.com/${randomUUID()}`])).rows[0]
      await client.query('UPDATE source_candidates SET knowledge_demand_id=$1 WHERE id=$2',[demandId,source.id])
      const run = (await client.query(`INSERT INTO source_processing_runs(source_candidate_id,processing_version,status)
        VALUES ($1,'test-v1','completed') RETURNING id`,[source.id])).rows[0]
      await client.query(`INSERT INTO source_processing_runs(source_candidate_id,processing_version,status)
        VALUES ($1,'test-v2','extracting')`,[source.id])
      const task = (await client.query(`INSERT INTO pipeline_tasks(task_type,stage,dedupe_key,payload,status,source_candidate_id,processing_run_id)
        VALUES ('fragment_analysis','analyze',$1,'{}','completed',$2,$3) RETURNING id`,[randomUUID(),source.id,run.id])).rows[0]
      const candidate = (await client.query(`INSERT INTO knowledge_candidates(pipeline_task_id,stable_key,payload,content_hash,status,dangerous,confidence,quality_score,processing_run_id)
        VALUES ($1,$2,'{}',$3,'verified',false,.98,.98,$4) RETURNING id`,[task.id,`test.${randomUUID()}`,sha256Label(randomUUID()),run.id])).rows[0]
      await ensurePipelineWork(db)
      const queued = await client.query(`SELECT task.payload,task.processing_run_id FROM pipeline_tasks task
        JOIN knowledge_candidates candidate ON candidate.fidelity_task_id=task.id WHERE candidate.id=$1`,[candidate.id])
      expect(queued.rows[0]?.processing_run_id).toBe(run.id)
      expect(queued.rows[0]?.payload.audit_mode).toBe('fidelity')
      expect((await client.query('SELECT status FROM source_candidates WHERE id=$1',[source.id])).rows[0]!.status).toBe('completed')
    })
  })
})
