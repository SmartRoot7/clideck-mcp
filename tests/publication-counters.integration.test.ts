import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { integrationDatabaseUrl } from './helpers.js'

type Plan = { 'Node Type': string; 'Relation Name'?: string; 'Rows Removed by Filter'?: number; Plans?: Plan[] }
const suite = integrationDatabaseUrl ? describe : describe.skip

suite('publication history counters', () => {
  const pool = new pg.Pool({ connectionString: integrationDatabaseUrl, max: 2 })
  afterAll(() => pool.end())

  it('recounts a mixed-origin publication batch without scanning unrelated candidate history', async () => {
    const client = await pool.connect()
    await client.query('BEGIN')
    try {
      const origins = Array.from({ length: 50 }, () => randomUUID())
      const unrelated = randomUUID()
      await client.query(`INSERT INTO pipeline_tasks(id,task_type,stage,status,dedupe_key,payload)
        SELECT id,'fragment_analysis','analyze','completed',id::text,'{}'
        FROM unnest($1::uuid[]) id`, [[...origins, unrelated]])
      await client.query(`INSERT INTO agent_runs(pipeline_task_id,model,reasoning_effort,status,published_revisions)
        SELECT id,'gpt-6-luna','low','completed',CASE WHEN id=$2 THEN 99 ELSE 0 END
        FROM unnest($1::uuid[]) id`, [[...origins, unrelated], unrelated])
      // A retried extractor has another historical run for the same origin.
      await client.query(`INSERT INTO agent_runs(pipeline_task_id,model,reasoning_effort,status)
        VALUES ($1,'gpt-6-luna','low','failed')`, [origins[0]])
      await client.query(`INSERT INTO knowledge_candidates
        (pipeline_task_id,stable_key,payload,content_hash,status,dangerous,confidence,quality_score)
        SELECT id,'fixture.counter.'||id||'.'||ordinal,'{}',
          'sha256:'||repeat(md5(id||':'||ordinal),2),
          CASE WHEN ordinal<=160 THEN 'published' ELSE 'rejected' END,false,.98,.98
        FROM unnest($1::uuid[]) id CROSS JOIN generate_series(1,200) ordinal`, [origins])
      await client.query('ANALYZE knowledge_candidates')
      await client.query('ANALYZE agent_runs')
      const candidates = await client.query<{ id: string }>(`SELECT DISTINCT ON (pipeline_task_id) id
        FROM knowledge_candidates WHERE pipeline_task_id=ANY($1::uuid[]) AND status='published'
        ORDER BY pipeline_task_id,id`, [origins])
      await client.query('SET LOCAL ROLE clideck_mcp_worker')
      const explained = await client.query<{ 'QUERY PLAN': Array<{ Plan: Plan }> }>(
        `EXPLAIN (ANALYZE, FORMAT JSON) UPDATE agent_runs run
          SET published_revisions=coalesce((SELECT count(*)::int FROM knowledge_candidates candidate
            WHERE candidate.pipeline_task_id=run.pipeline_task_id AND candidate.status='published'),0)
          WHERE run.pipeline_task_id IN (SELECT candidate.pipeline_task_id FROM knowledge_candidates candidate
            WHERE candidate.id=ANY($1::uuid[]))`, [candidates.rows.map(row => row.id)])
      const runs = (await client.query<{ pipeline_task_id: string; published_revisions: number }>(
        'SELECT pipeline_task_id,published_revisions FROM agent_runs WHERE pipeline_task_id=ANY($1::uuid[])',
        [[...origins, unrelated]])).rows
      expect(runs.filter(run => run.pipeline_task_id !== unrelated)).toHaveLength(51)
      expect(runs.filter(run => run.pipeline_task_id !== unrelated).every(run => run.published_revisions === 160)).toBe(true)
      expect(runs.find(run => run.pipeline_task_id === unrelated)?.published_revisions).toBe(99)
      const nodes = (plan: Plan): Plan[] => [plan, ...(plan.Plans ?? []).flatMap(nodes)]
      const historyScans = nodes(explained.rows[0]!['QUERY PLAN'][0]!.Plan)
        .filter(plan => plan['Relation Name'] === 'knowledge_candidates')
      // A status-only index can still read every origin's published history.
      expect(historyScans.reduce((total, plan) => total + (plan['Rows Removed by Filter'] ?? 0), 0)).toBe(0)
      expect(historyScans.filter(plan => plan['Node Type'] === 'Seq Scan')).toHaveLength(0)
    } finally {
      await client.query('ROLLBACK')
      client.release()
    }
  })
})
