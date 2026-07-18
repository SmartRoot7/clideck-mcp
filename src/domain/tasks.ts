import type { AppConfig } from '../config.js'
import {
  createPublicTaskId,
  randomUrlToken,
  sha256
} from '../crypto.js'
import type { Database } from '../db.js'
import type { PublicActor } from './auth.js'
import { getPublicRevision } from './knowledge.js'
import type {
  NetworkContextInput,
  PublicKnowledge
} from './schemas.js'

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
): PublicTaskStatus {
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
      row.status === 'queued' || row.status === 'claimed' ? 3_000 : 10_000
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
  return toPublicTaskStatus(row, answer)
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
    `WITH inserted AS (
       INSERT INTO task_messages (task_id, direction, body)
       VALUES ($1, 'client_to_researcher', $2)
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
    `UPDATE expert_tasks
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
  actor: PublicActor,
  input: {
    revision_ref?: string | undefined
    task_id?: string | undefined
    access_token?: string | undefined
    rating?: number | undefined
    category: 'correct' | 'incorrect' | 'outdated' | 'unsafe' | 'incomplete' | 'other'
    comment?: string | undefined
  },
): Promise<{ accepted: true; feedback_id: string }> {
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
  return { accepted: true, feedback_id: row.id }
}
