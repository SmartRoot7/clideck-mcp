import type {
  CreateTaskOptions,
  TaskStore
} from '@modelcontextprotocol/sdk/experimental/tasks/interfaces.js'
import type {
  Request,
  RequestId,
  Result,
  Task
} from '@modelcontextprotocol/sdk/types.js'

import { randomUrlToken } from '../crypto.js'
import type { Database } from '../db.js'
import type { PublicActor } from '../domain/auth.js'
import { getPublicRevision } from '../domain/knowledge.js'

type NativeTaskRow = {
  task_id: string
  status: Task['status']
  status_message: string | null
  ttl_ms: number | null
  poll_interval_ms: number | null
  created_at: string
  updated_at: string
  result_payload: Result | null
  public_id: string | null
  expert_status: string | null
  result_revision_id: string | null
  input_request: string | null
  failure_message: string | null
}

function mapExpertStatus(status: string | null): Task['status'] {
  switch (status) {
    case 'input_required':
      return 'input_required'
    case 'completed':
      return 'completed'
    case 'failed':
    case 'expired':
      return 'failed'
    case 'cancelled':
      return 'cancelled'
    default:
      return 'working'
  }
}

function toTask(row: NativeTaskRow): Task {
  const status = row.expert_status
    ? mapExpertStatus(row.expert_status)
    : row.status
  const task: Task = {
    taskId: row.task_id,
    status,
    ttl: row.ttl_ms,
    createdAt: new Date(row.created_at).toISOString(),
    lastUpdatedAt: new Date(row.updated_at).toISOString()
  }
  if (row.poll_interval_ms !== null) {
    task.pollInterval = row.poll_interval_ms
  }
  const statusMessage =
    row.input_request ?? row.failure_message ?? row.status_message
  if (statusMessage) task.statusMessage = statusMessage
  return task
}

export class PostgresTaskStore implements TaskStore {
  readonly #database: Database
  readonly #actor: PublicActor

  constructor(database: Database, actor: PublicActor) {
    this.#database = database
    this.#actor = actor
  }

  async createTask(
    taskParams: CreateTaskOptions,
    requestId: RequestId,
    request: Request,
    sessionId?: string,
  ): Promise<Task> {
    const taskId = `mpt_${randomUrlToken(32)}`
    const ttl = Math.max(
      60_000,
      Math.min(taskParams.ttl ?? 3_600_000, 86_400_000),
    )
    const pollInterval = Math.max(
      500,
      Math.min(taskParams.pollInterval ?? 3_000, 60_000),
    )
    const augmented =
      typeof request.params === 'object' &&
      request.params !== null &&
      'task' in request.params
    const result = await this.#database.query<NativeTaskRow>(
      `INSERT INTO mcp_protocol_tasks (
         task_id,
         tenant_id,
         session_id,
         request_id,
         original_request,
         status,
         ttl_ms,
         poll_interval_ms,
         expires_at
       )
       VALUES (
         $1, $2, $3, $4::jsonb, $5::jsonb, $8, $6::int, $7::int,
         now() + make_interval(secs => $6::double precision / 1000.0)
       )
       RETURNING
         task_id, status, status_message, ttl_ms, poll_interval_ms,
         created_at, updated_at, result_payload,
         NULL::text AS public_id,
         NULL::text AS expert_status,
         NULL::uuid AS result_revision_id,
         NULL::text AS input_request,
         NULL::text AS failure_message`,
      [
        taskId,
        this.#actor.kind === 'tenant' ? this.#actor.tenantId : null,
        sessionId ?? null,
        JSON.stringify(requestId),
        JSON.stringify(request),
        ttl,
        pollInterval,
        augmented ? 'working' : 'completed'
      ],
    )
    return toTask(result.rows[0]!)
  }

  async linkExpertTask(
    taskId: string,
    expertPublicId: string,
    fallbackResult: Result,
  ): Promise<void> {
    const result = await this.#database.query(
      `UPDATE mcp_protocol_tasks mpt
          SET expert_task_id = et.id,
              result_payload = CASE
                WHEN mpt.status = 'completed' THEN $4::jsonb
                ELSE mpt.result_payload
              END,
              updated_at = now()
         FROM expert_tasks et
        WHERE mpt.task_id = $1
          AND et.public_id = $2
          AND mpt.tenant_id IS NOT DISTINCT FROM $3::uuid
          AND (
            mpt.tenant_id IS NOT NULL
            OR et.tenant_id IS NULL
          )`,
      [
        taskId,
        expertPublicId,
        this.#actor.kind === 'tenant' ? this.#actor.tenantId : null,
        JSON.stringify(fallbackResult)
      ],
    )
    if (result.rowCount !== 1) throw new Error('NATIVE_TASK_LINK_FAILED')
  }

  async getTask(taskId: string, sessionId?: string): Promise<Task | null> {
    const row = await this.#loadTask(taskId, sessionId)
    return row ? toTask(row) : null
  }

  async storeTaskResult(
    taskId: string,
    status: 'completed' | 'failed',
    result: Result,
    sessionId?: string,
  ): Promise<void> {
    const update = await this.#database.query(
      `UPDATE mcp_protocol_tasks
          SET status = $2,
              result_payload = $3::jsonb,
              updated_at = now()
        WHERE task_id = $1
          AND tenant_id IS NOT DISTINCT FROM $4::uuid
          AND session_id IS NOT DISTINCT FROM $5`,
      [
        taskId,
        status,
        JSON.stringify(result),
        this.#actor.kind === 'tenant' ? this.#actor.tenantId : null,
        sessionId ?? null
      ],
    )
    if (update.rowCount !== 1) throw new Error('NATIVE_TASK_NOT_FOUND')
  }

  async getTaskResult(
    taskId: string,
    sessionId?: string,
  ): Promise<Result> {
    const row = await this.#loadTask(taskId, sessionId)
    if (!row) throw new Error('NATIVE_TASK_NOT_FOUND')
    if (row.result_payload) return row.result_payload

    if (row.expert_status !== 'completed' || !row.result_revision_id) {
      throw new Error('NATIVE_TASK_RESULT_NOT_READY')
    }
    const answer = await getPublicRevision(
      this.#database,
      row.result_revision_id,
    )
    const output = {
      task_id: row.public_id,
      status: 'completed',
      answer
    }
    return {
      content: [{ type: 'text', text: JSON.stringify(output) }],
      structuredContent: output
    }
  }

  async updateTaskStatus(
    taskId: string,
    status: Task['status'],
    statusMessage?: string,
    sessionId?: string,
  ): Promise<void> {
    const result = await this.#database.query(
      `WITH updated_native AS (
         UPDATE mcp_protocol_tasks
            SET status = $2,
                status_message = $3,
                updated_at = now()
          WHERE task_id = $1
            AND tenant_id IS NOT DISTINCT FROM $4::uuid
            AND session_id IS NOT DISTINCT FROM $5
          RETURNING expert_task_id
       )
       UPDATE expert_tasks et
          SET status = CASE WHEN $2 = 'cancelled' THEN 'cancelled' ELSE et.status END,
              completed_at = CASE WHEN $2 = 'cancelled' THEN now() ELSE et.completed_at END,
              updated_at = now()
        FROM updated_native un
       WHERE et.id = un.expert_task_id
       RETURNING et.id`,
      [
        taskId,
        status,
        statusMessage ?? null,
        this.#actor.kind === 'tenant' ? this.#actor.tenantId : null,
        sessionId ?? null
      ],
    )
    if (result.rowCount === 0) {
      const exists = await this.getTask(taskId, sessionId)
      if (!exists) throw new Error('NATIVE_TASK_NOT_FOUND')
    }
  }

  async listTasks(
    cursor?: string,
    sessionId?: string,
  ): Promise<{ tasks: Task[]; nextCursor?: string }> {
    if (this.#actor.kind === 'anonymous') return { tasks: [] }
    const result = await this.#database.query<NativeTaskRow>(
      `SELECT
         mpt.task_id,
         mpt.status,
         mpt.status_message,
         mpt.ttl_ms,
         mpt.poll_interval_ms,
         mpt.created_at,
         mpt.updated_at,
         mpt.result_payload,
         et.public_id,
         et.status AS expert_status,
         et.result_revision_id,
         et.input_request,
         et.failure_message
       FROM mcp_protocol_tasks mpt
       LEFT JOIN expert_tasks et ON et.id = mpt.expert_task_id
       WHERE mpt.tenant_id = $1
         AND mpt.session_id IS NOT DISTINCT FROM $2
         AND ($3::text IS NULL OR mpt.task_id < $3)
         AND (mpt.expires_at IS NULL OR mpt.expires_at > now())
       ORDER BY mpt.task_id DESC
       LIMIT 51`,
      [this.#actor.tenantId, sessionId ?? null, cursor ?? null],
    )
    const hasMore = result.rows.length > 50
    const rows = result.rows.slice(0, 50)
    const response: { tasks: Task[]; nextCursor?: string } = {
      tasks: rows.map(toTask)
    }
    if (hasMore && rows.at(-1)) response.nextCursor = rows.at(-1)!.task_id
    return response
  }

  async #loadTask(
    taskId: string,
    sessionId?: string,
  ): Promise<NativeTaskRow | null> {
    const result = await this.#database.query<NativeTaskRow>(
      `SELECT
         mpt.task_id,
         mpt.status,
         mpt.status_message,
         mpt.ttl_ms,
         mpt.poll_interval_ms,
         mpt.created_at,
         mpt.updated_at,
         mpt.result_payload,
         et.public_id,
         et.status AS expert_status,
         et.result_revision_id,
         et.input_request,
         et.failure_message
       FROM mcp_protocol_tasks mpt
       LEFT JOIN expert_tasks et ON et.id = mpt.expert_task_id
       WHERE mpt.task_id = $1
         AND mpt.tenant_id IS NOT DISTINCT FROM $2::uuid
         AND mpt.session_id IS NOT DISTINCT FROM $3
         AND (mpt.expires_at IS NULL OR mpt.expires_at > now())`,
      [
        taskId,
        this.#actor.kind === 'tenant' ? this.#actor.tenantId : null,
        sessionId ?? null
      ],
    )
    return result.rows[0] ?? null
  }
}
