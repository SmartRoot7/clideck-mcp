import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import pg from 'pg'
import { sha256, sha256Label } from '../src/crypto.js'
import type { Database } from '../src/db.js'
import { failPipelineTask } from '../src/domain/pipeline.js'
import { reconcileTerminalProcessingRunsWithClient } from '../src/domain/intake.js'
import { integrationDatabaseUrl } from './helpers.js'

const describeIntegration = integrationDatabaseUrl ? describe : describe.skip

describeIntegration('Fragment authentication failure isolation', () => {
  const database = new pg.Pool({ connectionString: integrationDatabaseUrl })
  afterAll(async () => database.end())

  it.each([false,true])('keeps auth failure local with finite retries (remaining: %s)', async remaining => {
    const client = await database.connect()
    try {
      await client.query('BEGIN')
      const transactionDatabase = {
        connect: async () => ({
          query: (sql: string | {text:string;values?:unknown[]}, parameters?: unknown[]) => {
            const text = typeof sql === 'string' ? sql : sql.text
            return /^(BEGIN|COMMIT|ROLLBACK)$/.test(text.trim())
              ? Promise.resolve({ rows: [] }) : typeof sql === 'string'
                ? client.query(sql,parameters) : client.query(sql)
          },
          release: () => undefined
        })
      } as unknown as Database
      await client.query('UPDATE pipeline_settings SET enabled=false WHERE singleton')
      const source = (await client.query<{id:string}>(`INSERT INTO source_candidates
        (canonical_url,document_type,title,status,discovered_by)
        VALUES ($1,'command_reference','Auth failure fixture','analyzing','integration-test') RETURNING id`,
      [`https://example.invalid/fragment-auth-${randomUUID()}`])).rows[0]!.id
      const artifact = (await client.query<{id:string}>(`INSERT INTO source_artifacts
        (source_candidate_id,media_type,byte_size,content_hash,storage_path,status)
        VALUES ($1,'text/plain',64,$2,'/tmp/fragment-auth','chunked') RETURNING id`,
      [source,sha256Label(randomUUID())])).rows[0]!.id
      const run = (await client.query<{id:string}>(`INSERT INTO source_processing_runs
        (source_candidate_id,source_artifact_id,processing_version,status)
        VALUES ($1,$2,'auth-fixture','extracting') RETURNING id`,[source,artifact])).rows[0]!.id
      const lease = randomUUID()
      const task = (await client.query<{id:string}>(`INSERT INTO pipeline_tasks
        (task_type,stage,status,priority,source_candidate_id,processing_run_id,dedupe_key,
         payload,claim_owner,lease_token_hash,lease_until,attempts)
        VALUES ('fragment_analysis','analyze','running',80,$1,$2,$3,'{}',
          'auth-fixture',$4,now()+interval '1 hour',5) RETURNING id`,
      [source,run,randomUUID(),sha256(lease)])).rows[0]!.id
      await client.query(`INSERT INTO source_fragments
        (source_artifact_id,processing_run_id,ordinal,content,content_hash,status,attempts,reservation_task_id)
        VALUES ($1,$2,1,'Attempted batch',$3,'analyzing',5,$4)`,[artifact,run,sha256Label(randomUUID()),task])
      if (remaining) await client.query(`INSERT INTO source_fragments
        (source_artifact_id,processing_run_id,ordinal,content,content_hash,status,attempts)
        VALUES ($1,$2,2,'Untouched evidence',$3,'queued',0)`,[artifact,run,sha256Label(randomUUID())])
      expect(await failPipelineTask(transactionDatabase,{
        pipeline_task_id:task,lease_token:lease,failure_code:'CODEX_AUTH_FAILED',
        failure_message:'The ephemeral Codex process failed before producing an artifact.'
      })).toMatchObject({status:'failed',retrying:false})
      // The mechanical worker reconciles terminal runs on its next tick.
      await reconcileTerminalProcessingRunsWithClient(client,[run])
      expect((await client.query('SELECT status FROM source_processing_runs WHERE id=$1',[run])).rows[0])
        .toEqual({status:remaining?'extracting':'failed'})
      const fragments = (await client.query('SELECT status,attempts FROM source_fragments WHERE processing_run_id=$1 ORDER BY ordinal',[run])).rows
      expect(fragments[0]).toEqual({status:'failed',attempts:5})
      if (remaining) expect(fragments[1]).toEqual({status:'queued',attempts:0})
    } finally {
      await client.query('ROLLBACK')
      client.release()
    }
  })

  it.each([false,true])('recovers untouched auth-cleanup evidence only (newer: %s)', async newer => {
    const client = await database.connect()
    try {
      await client.query('BEGIN')
      const source = (await client.query<{id:string}>(`INSERT INTO source_candidates
        (canonical_url,document_type,title,status,discovered_by)
        VALUES ($1,'command_reference','Auth recovery fixture','verifying','integration-test') RETURNING id`,
      [`https://example.invalid/auth-repair-${randomUUID()}`])).rows[0]!.id
      const artifact = (await client.query<{id:string}>(`INSERT INTO source_artifacts
        (source_candidate_id,media_type,byte_size,content_hash,storage_path,status)
        VALUES ($1,'text/plain',64,$2,'/tmp/auth-repair','chunked') RETURNING id`,
      [source,sha256Label(randomUUID())])).rows[0]!.id
      const run = (await client.query<{id:string}>(`INSERT INTO source_processing_runs
        (source_candidate_id,source_artifact_id,processing_version,status,failure_code,created_at,completed_at)
        VALUES ($1,$2,'auth-recovery-fixture','failed','CODEX_AUTH_FAILED','2026-11-17 17:00Z','2026-11-17 18:00Z') RETURNING id`,
      [source,artifact])).rows[0]!.id
      await client.query(`INSERT INTO pipeline_tasks
        (task_type,stage,status,priority,processing_run_id,dedupe_key,payload,failure_code,attempts,completed_at)
        VALUES ('fragment_analysis','analyze','failed',80,$1,$2,'{}','CODEX_AUTH_FAILED',5,'2026-11-17 18:00Z')`,[run,randomUUID()])
      if (newer) await client.query(`INSERT INTO source_processing_runs
        (source_candidate_id,source_artifact_id,processing_version,status,created_at)
        VALUES ($1,$2,'newer-auth-fixture','extracting','2026-11-17 19:00Z')`,[source,artifact])
      const original = (await client.query(`INSERT INTO source_fragments
        (source_artifact_id,processing_run_id,ordinal,content,content_hash,status,attempts,disposition,updated_at)
        SELECT $1,$2,n,'Evidence '||n,'sha256:'||repeat(n::text,64),
          CASE WHEN n=4 THEN 'published' ELSE 'failed' END,
          CASE WHEN n=2 THEN 5 ELSE 0 END,
          CASE WHEN n=3 THEN 'targeted_retry' ELSE NULL END,'2026-11-17 18:00Z'
        FROM generate_series(1,4) n RETURNING *`,[artifact,run])).rows
      const migration = (await readFile('migrations/056_fragment_auth_failure_recovery.sql','utf8'))
        .replace(/^BEGIN;\s*/,'').replace(/COMMIT;\s*$/,'')
      await client.query(migration)
      await client.query(migration)
      const recovered = (await client.query(`SELECT f.content_hash,f.attempts,f.status,r.counters
        FROM source_fragments f JOIN source_processing_runs r ON r.id=f.processing_run_id
        WHERE r.source_candidate_id=$1 AND r.processing_version LIKE 'fragment-auth-repair-056-%'`,[source])).rows
      expect(recovered).toHaveLength(newer?0:1)
      if (!newer) expect(recovered[0]).toMatchObject({content_hash:'sha256:'+'1'.repeat(64),attempts:0,status:'queued',counters:{repair_of_processing_run:run}})
      expect((await client.query('SELECT * FROM source_fragments WHERE processing_run_id=$1 ORDER BY ordinal',[run])).rows).toEqual(original)
      expect((await client.query('SELECT status FROM source_processing_runs WHERE id=$1',[run])).rows[0]).toEqual({status:'failed'})
      expect((await client.query('SELECT status FROM source_candidates WHERE id=$1',[source])).rows[0]).toEqual({status:newer?'verifying':'prepared'})
    } finally {
      await client.query('ROLLBACK')
      client.release()
    }
  })
})
