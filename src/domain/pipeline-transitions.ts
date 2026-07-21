import type { Database, DatabaseClient } from '../db.js'

export type PipelineTransitionScope = 'source' | 'record'
export type PipelineTransitionKind =
  | 'progress'
  | 'escalation'
  | 'retry'
  | 'terminal'

type TransitionWriter = Pick<DatabaseClient, 'query'>

export const PIPELINE_TRANSITION_ROUTES = [
  'source:discover:acquire',
  'source:discover:analyze',
  'source:acquire:downloaded',
  'source:downloaded:convert',
  'source:convert:chunk',
  'source:chunk:analyze',
  'record:analyze:verify',
  'record:verify:ready',
  'record:verify:deep_low',
  'record:verify:rejected',
  'record:verify:conflict',
  'record:deep_low:ready',
  'record:deep_low:deep_medium',
  'record:deep_low:rejected',
  'record:deep_low:conflict',
  'record:deep_medium:ready',
  'record:deep_medium:rejected',
  'record:deep_medium:conflict',
  'record:deep_medium:quarantine',
  'record:deep_medium:manual_exception',
  'record:ready:publish',
  'record:ready:deep_low',
  'record:ready:deep_medium'
] as const

const allowedRoutes = new Set<string>(PIPELINE_TRANSITION_ROUTES)

export type PipelineTransitionInput = {
  scope: PipelineTransitionScope
  fromStage: string
  toStage: string
  count: number
  kind: PipelineTransitionKind
  taskId: string
  dedupeSuffix?: string
}

export async function recordPipelineTransition(
  client: TransitionWriter,
  transition: PipelineTransitionInput,
): Promise<void> {
  if (!Number.isInteger(transition.count) || transition.count <= 0) return
  const route = [
    transition.scope,
    transition.fromStage,
    transition.toStage
  ].join(':')
  if (!allowedRoutes.has(route)) {
    throw new Error(`PIPELINE_TRANSITION_ROUTE_INVALID:${route}`)
  }
  const dedupeKey = [
    'transition',
    transition.taskId,
    transition.fromStage,
    transition.toStage,
    transition.kind,
    transition.dedupeSuffix ?? 'completion'
  ].join(':')
  await client.query(
    `INSERT INTO pipeline_transition_events (
       scope,
       from_stage,
       to_stage,
       item_count,
       transition_kind,
       pipeline_task_id,
       dedupe_key
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (dedupe_key) DO NOTHING`,
    [
      transition.scope,
      transition.fromStage,
      transition.toStage,
      transition.count,
      transition.kind,
      transition.taskId,
      dedupeKey
    ],
  )
}

export async function recordPipelineTransitions(
  client: TransitionWriter,
  transitions: PipelineTransitionInput[],
): Promise<void> {
  for (const transition of transitions) {
    await recordPipelineTransition(client, transition)
  }
}

export async function listPipelineTransitions(
  database: Database,
  after: string | null,
  limit = 100,
): Promise<Record<string, unknown>> {
  if (after === null) {
    const latest = await database.query<{ cursor: string }>(
      `SELECT coalesce(max(id), 0)::text AS cursor
       FROM pipeline_transition_events`,
    )
    return {
      next_cursor: latest.rows[0]?.cursor ?? '0',
      has_more: false,
      transitions: []
    }
  }

  const result = await database.query<{
    id: string
    scope: PipelineTransitionScope
    from_stage: string
    to_stage: string
    count: number
    kind: PipelineTransitionKind
    occurred_at: string | Date
  }>(
    `SELECT
       id::text,
       scope,
       from_stage,
       to_stage,
       item_count::int AS count,
       transition_kind AS kind,
       occurred_at
     FROM pipeline_transition_events
     WHERE id > $1::bigint
     ORDER BY pipeline_transition_events.id
     LIMIT $2`,
    [after, limit + 1],
  )
  const page = result.rows.slice(0, limit)
  return {
    next_cursor: page.at(-1)?.id ?? after,
    has_more: result.rows.length > limit,
    transitions: page.map(({ id: _id, ...transition }) => ({
      ...transition,
      occurred_at: new Date(transition.occurred_at).toISOString()
    }))
  }
}
