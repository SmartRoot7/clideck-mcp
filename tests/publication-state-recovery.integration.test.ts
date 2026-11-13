import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import pg from 'pg'
import { sha256Label } from '../src/crypto.js'
import { integrationDatabaseUrl } from './helpers.js'

const describeIntegration = integrationDatabaseUrl ? describe : describe.skip

describeIntegration('Candidate publication state recovery migration', () => {
  const database = new pg.Pool({ connectionString: integrationDatabaseUrl })
  afterAll(async () => database.end())

  it.each([false,true])('recovers only untouched evidence without a newer run (newer: %s)', async newer => {
    const client = await database.connect()
    try {
      await client.query('BEGIN')
      const source = (await client.query<{id:string}>(`INSERT INTO source_candidates
        (canonical_url,document_type,title,status,discovered_by)
        VALUES ($1,'command_reference','Fragment recovery fixture','verifying','integration-test') RETURNING id`,
      [`https://example.invalid/fragment-repair-${randomUUID()}`])).rows[0]!.id
      const artifact = (await client.query<{id:string}>(`INSERT INTO source_artifacts
        (source_candidate_id,media_type,byte_size,content_hash,storage_path,status)
        VALUES ($1,'text/plain',64,$2,'/tmp/fragment-repair','chunked') RETURNING id`,
      [source,sha256Label(randomUUID())])).rows[0]!.id
      const run = (await client.query<{id:string}>(`INSERT INTO source_processing_runs
        (id,source_candidate_id,source_artifact_id,processing_version,status,failure_code,created_at,completed_at)
        VALUES ('3960f37e-c7c8-4359-9b5b-686427799c14',$1,$2,'fragment-repair-054-fixture','failed','SOURCE_HTTP_403',now()-interval '2 hours',now()-interval '1 hour') RETURNING id`,
      [source,artifact])).rows[0]!.id
      if (newer) await client.query(`INSERT INTO source_processing_runs
        (source_candidate_id,source_artifact_id,processing_version,status)
        VALUES ($1,$2,'newer-fixture','extracting')`,[source,artifact])
      const original = (await client.query(`INSERT INTO source_fragments
        (source_artifact_id,processing_run_id,ordinal,content,content_hash,status,attempts,disposition,updated_at)
        SELECT $1,$2,n,'Evidence '||n,'sha256:'||repeat(n::text,64),
          CASE WHEN n=4 THEN 'published' ELSE 'failed' END,
          CASE WHEN n=2 THEN 10 ELSE 0 END,
          CASE WHEN n=3 THEN 'targeted_retry' ELSE NULL END,
          now()-interval '1 hour'
        FROM generate_series(1,4) n RETURNING *`,[artifact,run])).rows
      const migration = (await readFile('migrations/055_candidate_publication_state_recovery.sql','utf8'))
        .replace(/^BEGIN;\s*/,'').replace(/COMMIT;\s*$/,'')
      await client.query(migration)
      await client.query(migration)
      const recovered = (await client.query(`SELECT fragment.content_hash,fragment.attempts,
        fragment.status,run.counters FROM source_fragments fragment JOIN source_processing_runs run
          ON run.id=fragment.processing_run_id
        WHERE run.source_candidate_id=$1 AND run.processing_version LIKE 'publication-repair-055-%'`,[source])).rows
      expect(recovered).toHaveLength(newer ? 0 : 1)
      if (!newer) expect(recovered[0]).toMatchObject({content_hash:'sha256:'+'1'.repeat(64),
        attempts:0,status:'queued',counters:{repair_of_processing_run:run}})
      expect((await client.query('SELECT * FROM source_fragments WHERE processing_run_id=$1 ORDER BY ordinal',[run])).rows)
        .toEqual(original)
      expect((await client.query('SELECT status FROM source_processing_runs WHERE id=$1',[run])).rows[0]?.['status']).toBe('failed')
      expect((await client.query('SELECT status FROM source_candidates WHERE id=$1',[source])).rows[0]?.['status'])
        .toBe(newer ? 'verifying' : 'prepared')
    } finally {
      await client.query('ROLLBACK')
      client.release()
    }
  })
})
