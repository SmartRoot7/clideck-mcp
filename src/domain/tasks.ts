import type { AppConfig } from '../config.js'
import {
  createPublicTaskId,
  randomUrlToken,
  sha256,
  sha256Label
} from '../crypto.js'
import type { Database } from '../db.js'
import type { PublicActor } from './auth.js'
import { getPublicRevision } from './knowledge.js'
import type {
  NetworkContextInput,
  PublicKnowledge
} from './schemas.js'
import { sanitizeSnapshot } from './snapshot.js'

type TaskRow = {
  id: string
  public_id: string
  tenant_id: string | null
  status:
    | 'queued'
    | 'claimed'
    | 'researching'
    | 'input_required'
    | 'validating'
    | 'completed'
    | 'failed'
    | 'cancelled'
    | 'expired'
  created_at: string | Date
  expires_at: string | Date
  input_request: string | null
  result_revision_id: string | null
  failure_code: string | null
  failure_message: string | null
}

export type PublicTaskStatus = {
  task_id: string
  status: TaskRow['status']
  created_at: string
  expires_at: string
  input_request: string | null
  answer: PublicKnowledge | null
  failure: { code: string; message: string } | null
  poll_after_ms: number
  stage:
    | 'queued'
    | 'researching'
    | 'conflict_check'
    | 'validating'
    | 'publishing'
    | 'completed'
    | 'failed'
    | 'cancelled'
  progress_percent: number
  milestones: Array<{
    stage: string
    progress_percent: number
    message: string
    created_at: string
  }>
  published_release_sequence: number | null
}

type PublicTaskEventRow = {
  stage: PublicTaskStatus['stage']
  progress_percent: number
  public_message: string
  created_at: string | Date
}

export async function createExpertTask(
  database: Database,
  config: AppConfig,
  actor: PublicActor,
  question: string,
  context: NetworkContextInput,
): Promise<PublicTaskStatus & { access_token?: string }> {
  const publicId = createPublicTaskId()
  const accessToken =
    actor.kind === 'anonymous' ? randomUrlToken(32) : undefined

  const result = await database.query<TaskRow>(
    `INSERT INTO expert_tasks (
       public_id,
       access_token_hash,
       tenant_id,
       question,
       network_context,
       expires_at
     ) VALUES (
       $1,
       $2,
       $3,
       $4,
       $5::jsonb,
       now() + make_interval(mins => $6::int)
     )
     RETURNING
       id, public_id, tenant_id, status, created_at, expires_at,
       input_request, result_revision_id, failure_code, failure_message`,
    [
      publicId,
      accessToken ? sha256(accessToken) : null,
      actor.kind === 'tenant' ? actor.tenantId : null,
      question,
      JSON.stringify(context),
      config.anonymousTaskTtlMinutes
    ],
  )

  const task = toPublicTaskStatus(result.rows[0]!)
  await database.query(
    `INSERT INTO task_public_events (
       task_id, stage, progress_percent, public_message
     )
     VALUES ($1, 'queued', 5, 'Research task queued for deterministic review.')`,
    [result.rows[0]!.id],
  )
  task.milestones = [{
    stage: 'queued',
    progress_percent: 5,
    message: 'Research task queued for deterministic review.',
    created_at: task.created_at
  }]
  task.progress_percent = 5
  return accessToken ? { ...task, access_token: accessToken } : task
}

async function loadAuthorizedTask(
  database: Database,
  actor: PublicActor,
  publicId: string,
  accessToken: string | undefined,
): Promise<TaskRow | null> {
  const result = await database.query<TaskRow>(
    `SELECT
       id, public_id, tenant_id, status, created_at, expires_at,
       input_request, result_revision_id, failure_code, failure_message
     FROM expert_tasks
     WHERE public_id = $1
       AND expires_at > now()
       AND (
         ($2::uuid IS NOT NULL AND tenant_id = $2)
         OR (
           $2::uuid IS NULL
           AND tenant_id IS NULL
           AND access_token_hash = $3
         )
       )`,
    [
      publicId,
      actor.kind === 'tenant' ? actor.tenantId : null,
      accessToken ? sha256(accessToken) : null
    ],
  )
  return result.rows[0] ?? null
}

function toPublicTaskStatus(
  row: TaskRow,
  answer: PublicKnowledge | null = null,
  events: PublicTaskEventRow[] = [],
  releaseSequence: number | null = null,
): PublicTaskStatus {
  const fallbackStage: PublicTaskStatus['stage'] =
    row.status === 'claimed' || row.status === 'researching'
      ? 'researching'
      : row.status === 'input_required'
        ? 'researching'
        : row.status === 'validating'
          ? 'validating'
          : row.status === 'completed'
            ? 'completed'
            : row.status === 'cancelled'
              ? 'cancelled'
              : row.status === 'failed' || row.status === 'expired'
                ? 'failed'
                : 'queued'
  const lastEvent = events.at(-1)
  return {
    task_id: row.public_id,
    status: row.status,
    created_at: new Date(row.created_at).toISOString(),
    expires_at: new Date(row.expires_at).toISOString(),
    input_request: row.input_request,
    answer,
    failure:
      row.failure_code && row.failure_message
        ? { code: row.failure_code, message: row.failure_message }
        : null,
    poll_after_ms:
      row.status === 'queued' || row.status === 'claimed' ? 3_000 : 10_000,
    stage: lastEvent?.stage ?? fallbackStage,
    progress_percent: lastEvent?.progress_percent ?? (
      fallbackStage === 'completed' ? 100 : fallbackStage === 'queued' ? 5 : 50
    ),
    milestones: events.map((event) => ({
      stage: event.stage,
      progress_percent: event.progress_percent,
      message: event.public_message,
      created_at: new Date(event.created_at).toISOString()
    })),
    published_release_sequence: releaseSequence
  }
}

async function loadTaskPresentation(
  database: Database,
  row: TaskRow,
): Promise<{
  events: PublicTaskEventRow[]
  releaseSequence: number | null
}> {
  const [events, release] = await Promise.all([
    database.query<PublicTaskEventRow>(
      `SELECT stage, progress_percent, public_message, created_at
       FROM task_public_events
       WHERE task_id = $1
       ORDER BY created_at, id`,
      [row.id],
    ),
    row.result_revision_id
      ? database.query<{ sequence: number }>(
          `SELECT r.sequence::int AS sequence
           FROM release_items ri
           JOIN releases r ON r.id = ri.release_id
           WHERE ri.revision_id = $1
           ORDER BY r.sequence DESC
           LIMIT 1`,
          [row.result_revision_id],
        )
      : Promise.resolve({ rows: [] as Array<{ sequence: number }> })
  ])
  return {
    events: events.rows,
    releaseSequence: release.rows[0]?.sequence ?? null
  }
}

export async function getExpertTask(
  database: Database,
  actor: PublicActor,
  publicId: string,
  accessToken: string | undefined,
): Promise<PublicTaskStatus> {
  const row = await loadAuthorizedTask(database, actor, publicId, accessToken)
  if (!row) throw new Error('EXPERT_TASK_NOT_FOUND')

  const answer = row.result_revision_id
    ? await getPublicRevision(database, row.result_revision_id)
    : null
  const presentation = await loadTaskPresentation(database, row)
  return toPublicTaskStatus(
    row,
    answer,
    presentation.events,
    presentation.releaseSequence,
  )
}

export async function continueExpertTask(
  database: Database,
  actor: PublicActor,
  publicId: string,
  accessToken: string | undefined,
  message: string,
): Promise<PublicTaskStatus> {
  const task = await loadAuthorizedTask(database, actor, publicId, accessToken)
  if (!task) throw new Error('EXPERT_TASK_NOT_FOUND')
  if (task.status !== 'input_required') {
    throw new Error('EXPERT_TASK_NOT_WAITING_FOR_INPUT')
  }

  await database.query(
    `WITH inserted_message AS (
       INSERT INTO task_messages (task_id, direction, body)
       VALUES ($1, 'client_to_researcher', $2)
     ), inserted_event AS (
       INSERT INTO task_public_events (
         task_id, stage, progress_percent, public_message
       )
       VALUES ($1, 'queued', 10, 'Additional input received; task returned to the queue.')
     )
     UPDATE expert_tasks
        SET status = 'queued',
            input_request = NULL,
            updated_at = now()
      WHERE id = $1`,
    [task.id, message],
  )
  return getExpertTask(database, actor, publicId, accessToken)
}

export async function cancelExpertTask(
  database: Database,
  actor: PublicActor,
  publicId: string,
  accessToken: string | undefined,
): Promise<PublicTaskStatus> {
  const task = await loadAuthorizedTask(database, actor, publicId, accessToken)
  if (!task) throw new Error('EXPERT_TASK_NOT_FOUND')
  if (['completed', 'failed', 'cancelled', 'expired'].includes(task.status)) {
    return toPublicTaskStatus(task)
  }

  await database.query(
    `WITH inserted_event AS (
       INSERT INTO task_public_events (
         task_id, stage, progress_percent, public_message
       )
       VALUES ($1, 'cancelled', 100, 'Research task cancelled by the requester.')
     )
     UPDATE expert_tasks
        SET status = 'cancelled',
            lease_token_hash = NULL,
            lease_until = NULL,
            completed_at = now(),
            updated_at = now()
      WHERE id = $1`,
    [task.id],
  )
  return getExpertTask(database, actor, publicId, accessToken)
}

export async function submitFeedback(
  database: Database,
  quarantineDatabase: Database,
  actor: PublicActor,
  input: {
    revision_ref?: string | undefined
    task_id?: string | undefined
    access_token?: string | undefined
    rating?: number | undefined
    category: 'correct' | 'incorrect' | 'outdated' | 'unsafe' | 'incomplete' | 'other'
    comment?: string | undefined
    sample_contribution?: {
      consent: true
      consent_version: '2026-07-01'
      snapshot_type: 'show_version' | 'config' | 'log' | 'topology' | 'other'
      sanitized_payload: string
      detected_context?: Record<string, string> | undefined
    } | undefined
  },
): Promise<{
  accepted: true
  feedback_id: string
  contribution_id?: string
}> {
  let internalTaskId: string | null = null
  if (input.task_id) {
    const task = await loadAuthorizedTask(
      database,
      actor,
      input.task_id,
      input.access_token,
    )
    if (!task) throw new Error('EXPERT_TASK_NOT_FOUND')
    internalTaskId = task.id
  }

  const result = await database.query<{ id: string }>(
    `INSERT INTO feedback (
       tenant_id, revision_id, task_id, rating, category, comment
     )
     SELECT $1, pak.revision_id, $3, $4, $5, $6
       FROM (SELECT $2::uuid AS revision_id) requested
       LEFT JOIN public_active_knowledge pak
         ON pak.revision_id = requested.revision_id
      WHERE $2::uuid IS NULL OR pak.revision_id IS NOT NULL
     RETURNING id`,
    [
      actor.kind === 'tenant' ? actor.tenantId : null,
      input.revision_ref ?? null,
      internalTaskId,
      input.rating ?? null,
      input.category,
      input.comment ?? null
    ],
  )
  const row = result.rows[0]
  if (!row) throw new Error('KNOWLEDGE_REVISION_NOT_FOUND')

  let contributionId: string | undefined
  if (input.sample_contribution) {
    const strict = sanitizeSnapshot(
      input.sample_contribution.sanitized_payload,
      'strict',
    ).sanitized
    const detectedContext = Object.fromEntries(
      Object.entries(input.sample_contribution.detected_context ?? {}).map(
        ([key, value]) => [
          key,
          sanitizeSnapshot(value.slice(0, 240), 'strict').sanitized
        ],
      ),
    )
    const contribution = await quarantineDatabase.query<{ id: string }>(
      `INSERT INTO snapshot_contributions (
         consent_version,
         snapshot_type,
         detected_context,
         sanitized_payload,
         content_hash
       )
       VALUES ($1, $2, $3::jsonb, $4, $5)
       ON CONFLICT (content_hash)
       DO UPDATE SET expires_at = greatest(
         snapshot_contributions.expires_at,
         now() + interval '30 days'
       )
       RETURNING id`,
      [
        input.sample_contribution.consent_version,
        input.sample_contribution.snapshot_type,
        JSON.stringify(detectedContext),
        strict,
        sha256Label(strict)
      ],
    )
    contributionId = contribution.rows[0]!.id
  }
  return {
    accepted: true,
    feedback_id: row.id,
    ...(contributionId ? { contribution_id: contributionId } : {})
  }
}
