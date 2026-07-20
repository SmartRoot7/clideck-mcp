import { randomUUID } from 'node:crypto'

import pg from 'pg'
import { afterAll, describe, expect, it } from 'vitest'

import type { Database } from '../src/db.js'
import {
  listPipelineTransitions,
  PIPELINE_TRANSITION_ROUTES,
  recordPipelineTransition
} from '../src/domain/pipeline-transitions.js'
import { integrationDatabaseUrl } from './helpers.js'

const { Pool } = pg
const describeIntegration = integrationDatabaseUrl ? describe : describe.skip

describeIntegration('pipeline transition events', () => {
  const database = new Pool({
    connectionString: integrationDatabaseUrl,
    max: 2
  })

  afterAll(async () => {
    await database.end()
  })

  it('grants worker roles every read needed by pipeline persistence', async () => {
    const privileges = await database.query<{
      worker: boolean
      researcher: boolean
      worker_context_aliases: boolean
    }>(
      `SELECT
         has_column_privilege(
           'clideck_mcp_worker',
           'pipeline_transition_events',
           'dedupe_key',
           'SELECT'
         ) AS worker,
         has_column_privilege(
           'clideck_mcp_researcher',
           'pipeline_transition_events',
           'dedupe_key',
           'SELECT'
         ) AS researcher,
         has_table_privilege(
           'clideck_mcp_worker',
           'context_aliases',
           'SELECT'
         ) AS worker_context_aliases`,
    )
    expect(privileges.rows[0]).toEqual({
      worker: true,
      researcher: true,
      worker_context_aliases: true
    })
  })

  it('primes a cursor without replay and exposes no internal task reference', async () => {
    const suffix = randomUUID()
    const task = await database.query<{ id: string }>(
      `INSERT INTO pipeline_tasks (
         task_type, stage, status, priority, dedupe_key, payload
       )
       VALUES ('candidate_verification', 'verify', 'queued', 1, $1, '{}'::jsonb)
       RETURNING id`,
      [`transition-${suffix}`],
    )
    const primed = await listPipelineTransitions(database, null)
    await recordPipelineTransition(database, {
      scope: 'record',
      fromStage: 'verify',
      toStage: 'ready',
      count: 18,
      kind: 'progress',
      taskId: task.rows[0]!.id
    })
    await recordPipelineTransition(database, {
      scope: 'record',
      fromStage: 'verify',
      toStage: 'ready',
      count: 18,
      kind: 'progress',
      taskId: task.rows[0]!.id
    })

    expect(primed['transitions']).toEqual([])
    const page = await listPipelineTransitions(
      database,
      String(primed['next_cursor']),
    )
    expect(page['transitions']).toEqual([
      expect.objectContaining({
        scope: 'record',
        from_stage: 'verify',
        to_stage: 'ready',
        count: 18
      })
    ])
    expect(JSON.stringify(page)).not.toContain(task.rows[0]!.id)
  })

  it('does not retain an event when the surrounding status transaction rolls back', async () => {
    const client = await database.connect()
    const suffix = randomUUID()
    let rolledBackTaskId = ''
    try {
      await client.query('BEGIN')
      const task = await client.query<{ id: string }>(
        `INSERT INTO pipeline_tasks (
           task_type, stage, status, priority, dedupe_key, payload
         )
         VALUES ('candidate_deep_review', 'deep_review', 'queued', 1, $1, '{}'::jsonb)
         RETURNING id`,
        [`transition-rollback-${suffix}`],
      )
      rolledBackTaskId = task.rows[0]!.id
      await recordPipelineTransition(client, {
        scope: 'record',
        fromStage: 'deep_low',
        toStage: 'deep_medium',
        count: 4,
        kind: 'escalation',
        taskId: task.rows[0]!.id
      })
      await client.query('ROLLBACK')
      const persisted = await database.query<{ count: number }>(
        `SELECT count(*)::int AS count
         FROM pipeline_transition_events
         WHERE pipeline_task_id = $1`,
        [rolledBackTaskId],
      )
      expect(persisted.rows[0]?.count).toBe(0)
    } finally {
      client.release()
    }
  })

  it('paginates by cursor without replaying acknowledged events', async () => {
    const suffix = randomUUID()
    const primed = await listPipelineTransitions(database, null)
    for (const [index, toStage] of ['ready', 'deep_low', 'rejected'].entries()) {
      const task = await database.query<{ id: string }>(
        `INSERT INTO pipeline_tasks (
           task_type, stage, status, priority, dedupe_key, payload
         )
         VALUES ('candidate_verification', 'verify', 'queued', 1, $1, '{}'::jsonb)
         RETURNING id`,
        [`transition-page-${suffix}-${index}`],
      )
      await recordPipelineTransition(database, {
        scope: 'record',
        fromStage: 'verify',
        toStage,
        count: index + 1,
        kind: toStage === 'ready'
          ? 'progress'
          : toStage === 'deep_low'
            ? 'escalation'
            : 'terminal',
        taskId: task.rows[0]!.id
      })
    }

    const first = await listPipelineTransitions(
      database,
      String(primed['next_cursor']),
      2,
    )
    expect(first['has_more']).toBe(true)
    expect(first['transitions']).toHaveLength(2)
    const second = await listPipelineTransitions(
      database,
      String(first['next_cursor']),
      2,
    )
    expect(second['has_more']).toBe(false)
    expect(second['transitions']).toHaveLength(1)
    expect(new Set([
      ...(first['transitions'] as Array<{ to_stage: string }>),
      ...(second['transitions'] as Array<{ to_stage: string }>)
    ].map((row) => row.to_stage))).toEqual(
      new Set(['ready', 'deep_low', 'rejected']),
    )
  })

  it('keeps the cursor numerically monotonic across decimal digit boundaries', async () => {
    const suffix = randomUUID()
    const task = await database.query<{ id: string }>(
      `INSERT INTO pipeline_tasks (
         task_type, stage, status, priority, dedupe_key, payload
       )
       VALUES ('candidate_verification', 'verify', 'queued', 1, $1, '{}'::jsonb)
       RETURNING id`,
      [`transition-numeric-cursor-${suffix}`],
    )
    const primed = await listPipelineTransitions(database, null)
    for (let index = 1; index <= 60; index += 1) {
      await recordPipelineTransition(database, {
        scope: 'record',
        fromStage: 'verify',
        toStage: 'ready',
        count: 1_000 + index,
        kind: 'progress',
        taskId: task.rows[0]!.id,
        dedupeSuffix: `numeric-cursor-${index}`
      })
    }
    const maxId = await database.query<{ id: string }>(
      `SELECT max(id)::text AS id
       FROM pipeline_transition_events`,
    )
    const page = await listPipelineTransitions(
      database,
      String(primed['next_cursor']),
    )
    const insertedCounts = (
      page['transitions'] as Array<{ count: number }>
    )
      .map((transition) => transition.count)
      .filter((count) => count >= 1_001 && count <= 1_060)

    expect(insertedCounts).toEqual(
      Array.from({ length: 60 }, (_, index) => 1_001 + index),
    )
    expect(page['next_cursor']).toBe(maxId.rows[0]?.id)
  })

  it('persists every declared route accepted by the transition contract', async () => {
    const task = await database.query<{ id: string }>(
      `INSERT INTO pipeline_tasks (
         task_type, stage, status, priority, dedupe_key, payload
       )
       VALUES ('candidate_deep_review', 'deep_review', 'queued', 1, $1, '{}'::jsonb)
       RETURNING id`,
      [`transition-routes-${randomUUID()}`],
    )
    for (const route of PIPELINE_TRANSITION_ROUTES) {
      const [scope, fromStage, toStage] = route.split(':') as [
        'source' | 'record',
        string,
        string
      ]
      await recordPipelineTransition(database, {
        scope,
        fromStage,
        toStage,
        count: 1,
        kind:
          toStage === 'rejected' ||
          toStage === 'conflict' ||
          toStage === 'quarantine' ||
          toStage === 'manual_exception'
            ? 'terminal'
            : toStage === 'deep_low' || toStage === 'deep_medium'
              ? 'escalation'
              : 'progress',
        taskId: task.rows[0]!.id
      })
    }
    const persisted = await database.query<{ count: number }>(
      `SELECT count(*)::int AS count
       FROM pipeline_transition_events
       WHERE pipeline_task_id = $1`,
      [task.rows[0]!.id],
    )
    expect(persisted.rows[0]?.count).toBe(PIPELINE_TRANSITION_ROUTES.length)
  })
})

describe('pipeline transition route contract', () => {
  it('contains every supported source and branching record route', () => {
    expect(PIPELINE_TRANSITION_ROUTES).toEqual(expect.arrayContaining([
      'source:discover:acquire',
      'source:acquire:downloaded',
      'source:downloaded:convert',
      'source:convert:chunk',
      'source:chunk:analyze',
      'record:analyze:verify',
      'record:verify:ready',
      'record:verify:deep_low',
      'record:deep_low:ready',
      'record:deep_low:deep_medium',
      'record:deep_medium:quarantine',
      'record:deep_medium:manual_exception',
      'record:ready:publish',
      'record:ready:deep_low',
      'record:ready:deep_medium'
    ]))
  })
})
