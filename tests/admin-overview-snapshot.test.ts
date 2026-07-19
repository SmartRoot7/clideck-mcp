import { randomUUID } from 'node:crypto'

import pg from 'pg'
import { afterAll, describe, expect, it } from 'vitest'

import { sha256Label } from '../src/crypto.js'
import type { Database } from '../src/db.js'
import { getAdminOverview } from '../src/domain/admin.js'
import { integrationDatabaseUrl } from './helpers.js'

const { Pool } = pg
const describeIntegration = integrationDatabaseUrl ? describe : describe.skip

type FunnelStage = {
  stage: string
  waiting: number
  running: number
  active_executor_ids: string[]
  active_worker_count: number
}

describeIntegration('admin runtime snapshot', () => {
  const database = new Pool({
    connectionString: integrationDatabaseUrl,
    max: 2
  })

  afterAll(async () => {
    await database.end()
  })

  it('reports real waiting items and executor tasks from one snapshot', async () => {
    const client = await database.connect()
    const suffix = randomUUID().replaceAll('-', '').slice(0, 12)
    try {
      await client.query('BEGIN')
      const before = await getAdminOverview(
        client as unknown as Database,
        'snapshot-before',
      )
      const beforeStages = new Map(
        (before['pipeline_funnel'] as FunnelStage[]).map(
          (stage) => [stage.stage, stage],
        ),
      )

      const target = await client.query<{ id: string }>(
        `INSERT INTO coverage_targets (
           vendor_slug,
           operating_system_slug,
           document_role,
           status,
           priority,
           next_check_at
         )
         VALUES ($1, $2, 'commands', 'queued', 1, now())
         RETURNING id`,
        [`snapshot-${suffix}`, `snapshot-os-${suffix}`],
      )
      const targetId = target.rows[0]!.id

      const insertSource = async (status: string, label: string) => {
        const source = await client.query<{ id: string }>(
          `INSERT INTO source_candidates (
             coverage_target_id,
             canonical_url,
             document_type,
             title,
             status,
             discovered_by
           )
           VALUES ($1, $2, 'text/html', $3, $4, 'integration-test')
           RETURNING id`,
          [
            targetId,
            `https://example.com/${suffix}/${label}`,
            `Snapshot ${label}`,
            status
          ],
        )
        return source.rows[0]!.id
      }

      await insertSource('approved', 'acquire')
      await insertSource('acquired', 'convert')
      await insertSource('converted', 'chunk')
      const analyzeSourceId = await insertSource('analyzing', 'analyze')
      const publishSourceId = await insertSource('verifying', 'publish')

      const artifact = await client.query<{ id: string }>(
        `INSERT INTO source_artifacts (
           source_candidate_id,
           media_type,
           byte_size,
           content_hash,
           storage_path,
           status
         )
         VALUES ($1, 'text/plain', 100, $2, $3, 'chunked')
         RETURNING id`,
        [
          analyzeSourceId,
          sha256Label(`artifact-${suffix}`),
          `/tmp/snapshot-${suffix}`
        ],
      )
      await client.query(
        `INSERT INTO source_fragments (
           source_artifact_id,
           ordinal,
           content,
           content_hash,
           status
         )
         VALUES ($1, 0, 'show version', $2, 'queued')`,
        [artifact.rows[0]!.id, sha256Label(`fragment-${suffix}`)],
      )

      const originTask = await client.query<{ id: string }>(
        `INSERT INTO pipeline_tasks (
           task_type,
           stage,
           status,
           priority,
           source_candidate_id,
           dedupe_key,
           payload,
           completed_at
         )
         VALUES (
           'fragment_analysis',
           'analyze',
           'completed',
           1,
           $1,
           $2,
           '{}'::jsonb,
           now()
         )
         RETURNING id`,
        [publishSourceId, `snapshot-origin-${suffix}`],
      )
      const insertCandidate = async (
        status: 'analyzed' | 'deep_review' | 'verified',
        label: string,
      ) => {
        await client.query(
          `INSERT INTO knowledge_candidates (
             pipeline_task_id,
             stable_key,
             payload,
             content_hash,
             status,
             dangerous,
             confidence,
             quality_score
           )
           VALUES (
             $1,
             $2,
             '{}'::jsonb,
             $3,
             $4,
             false,
             0.990,
             0.990
           )`,
          [
            originTask.rows[0]!.id,
            `snapshot.${suffix}.${label}`,
            sha256Label(`candidate-${suffix}-${label}`),
            status
          ],
        )
      }
      await insertCandidate('analyzed', 'verify')
      await insertCandidate('deep_review', 'deep')
      await insertCandidate('verified', 'publish')

      await client.query(
        `INSERT INTO pipeline_tasks (
           task_type,
           stage,
           status,
           priority,
           source_candidate_id,
           dedupe_key,
           payload
         )
         VALUES (
           'source_publication',
           'publish',
           'queued',
           1,
           $1,
           $2,
           '{}'::jsonb
         )`,
        [publishSourceId, `snapshot-publish-${suffix}`],
      )

      const insertRunningTask = async (
        taskType: string,
        stage: string,
        owner: string,
        label: string,
      ) => {
        await client.query(
          `INSERT INTO pipeline_tasks (
             task_type,
             stage,
             status,
             priority,
             dedupe_key,
             payload,
             claim_owner,
             lease_until,
             heartbeat_at
           )
           VALUES (
             $1,
             $2,
             'running',
             1,
             $3,
             '{}'::jsonb,
             $4,
             now() + interval '5 minutes',
             now()
           )`,
          [taskType, stage, `snapshot-running-${label}-${suffix}`, owner],
        )
      }
      await insertRunningTask(
        'fragment_analysis',
        'analyze',
        'pipeline-executor-01',
        'analyze',
      )
      await insertRunningTask(
        'candidate_deep_review',
        'deep_review',
        'pipeline-executor-02',
        'deep',
      )
      await insertRunningTask(
        'source_conversion',
        'convert',
        'mechanical-snapshot-worker',
        'convert',
      )
      await client.query(
        `INSERT INTO pipeline_tasks (
           task_type,
           stage,
           status,
           priority,
           dedupe_key,
           payload,
           claim_owner,
           lease_until,
           heartbeat_at
         )
         VALUES (
           'candidate_verification',
           'verify',
           'running',
           1,
           $1,
           '{}'::jsonb,
           'pipeline-executor-04',
           now() - interval '1 minute',
           now() - interval '1 minute'
         )`,
        [`snapshot-expired-${suffix}`],
      )

      for (const [executor, staleStage] of [
        ['pipeline-executor-01', 'deep_review'],
        ['pipeline-executor-02', 'verify'],
        ['pipeline-executor-03', 'analyze'],
        ['pipeline-executor-04', 'verify']
      ]) {
        await client.query(
          `INSERT INTO worker_heartbeats (
             worker_name,
             instance_id,
             heartbeat_at,
             metadata
           )
           VALUES ($1, $2, now(), $3::jsonb)
           ON CONFLICT (worker_name)
           DO UPDATE SET
             instance_id = excluded.instance_id,
             heartbeat_at = excluded.heartbeat_at,
             metadata = excluded.metadata`,
          [
            executor,
            `${executor}:snapshot`,
            JSON.stringify({ status: 'running', stage: staleStage })
          ],
        )
      }

      const after = await getAdminOverview(
        client as unknown as Database,
        'snapshot-after',
      )
      const afterStages = new Map(
        (after['pipeline_funnel'] as FunnelStage[]).map(
          (stage) => [stage.stage, stage],
        ),
      )
      for (const stage of [
        'discover',
        'acquire',
        'convert',
        'chunk',
        'analyze',
        'verify',
        'deep_review',
        'publish'
      ]) {
        expect(afterStages.get(stage)!.waiting).toBeGreaterThanOrEqual(
          beforeStages.get(stage)!.waiting + 1,
        )
      }
      expect(afterStages.get('analyze')).toMatchObject({
        active_executor_ids: expect.arrayContaining([
          'pipeline-executor-01'
        ])
      })
      expect(afterStages.get('deep_review')).toMatchObject({
        active_executor_ids: expect.arrayContaining([
          'pipeline-executor-02'
        ])
      })
      expect(
        afterStages.get('convert')!.active_worker_count,
      ).toBeGreaterThanOrEqual(1)

      const executors = after['executors'] as Array<{
        executor_id: string
        state: string
        stage: string | null
      }>
      expect(executors.find(
        (executor) => executor.executor_id === 'pipeline-executor-01',
      )).toMatchObject({ state: 'running', stage: 'analyze' })
      expect(executors.find(
        (executor) => executor.executor_id === 'pipeline-executor-02',
      )).toMatchObject({ state: 'running', stage: 'deep_review' })
      expect(executors.find(
        (executor) => executor.executor_id === 'pipeline-executor-03',
      )).toMatchObject({ state: 'standby', stage: null })
      expect(executors.find(
        (executor) => executor.executor_id === 'pipeline-executor-04',
      )).toMatchObject({ state: 'standby', stage: null })
    } finally {
      await client.query('ROLLBACK')
      client.release()
    }
  }, 30_000)
})
