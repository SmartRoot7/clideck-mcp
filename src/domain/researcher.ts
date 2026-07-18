import type { AppConfig } from '../config.js'
import {
  randomUrlToken,
  sha256,
  sha256Label
} from '../crypto.js'
import type { Database } from '../db.js'
import { withTransaction } from '../db.js'
import { assertSafeProvenanceUrl } from '../security/url-policy.js'
import {
  candidateRevisionSchema,
  type CandidateRevision
} from './schemas.js'

type ResearchTaskRow = {
  id: string
  public_id: string
  question: string
  network_context: Record<string, unknown>
  attempts: number
  expires_at: string | Date
}

export async function claimResearchTask(
  database: Database,
  config: AppConfig,
  researcherId: string,
): Promise<Record<string, unknown>> {
  const leaseToken = randomUrlToken(32)
  const row = await withTransaction(database, async (client) => {
    const result = await client.query<ResearchTaskRow>(
      `SELECT
         id, public_id, question, network_context, attempts, expires_at
       FROM expert_tasks
       WHERE status = 'queued'
         AND expires_at > now()
         AND attempts < 5
       ORDER BY priority DESC, created_at
       FOR UPDATE SKIP LOCKED
       LIMIT 1`,
    )
    const task = result.rows[0]
    if (!task) return null

    await client.query(
      `UPDATE expert_tasks
          SET status = 'researching',
              attempts = attempts + 1,
              claim_owner = $2,
              lease_token_hash = $3,
              lease_until = now() + make_interval(secs => $4),
              heartbeat_at = now(),
              updated_at = now()
        WHERE id = $1`,
      [task.id, researcherId, sha256(leaseToken), config.taskLeaseSeconds],
    )
    await client.query(
      `INSERT INTO task_public_events (
         task_id, stage, progress_percent, public_message
       )
       VALUES (
         $1,
         'researching',
         25,
         'A restricted researcher is structuring a candidate answer.'
       )`,
      [task.id],
    )
    const messages = await client.query<{ body: string; created_at: string }>(
      `SELECT body, created_at
       FROM task_messages
       WHERE task_id = $1
       ORDER BY id
       LIMIT 20`,
      [task.id],
    )
    return {
      task_id: task.public_id,
      lease_token: leaseToken,
      question: task.question,
      context: task.network_context,
      prior_messages: messages.rows,
      attempt: task.attempts + 1,
      expires_at: new Date(task.expires_at).toISOString(),
      lease_seconds: config.taskLeaseSeconds
    }
  })
  return row ?? { available: false }
}

async function loadLeasedTask(
  database: Database,
  publicId: string,
  leaseToken: string,
): Promise<ResearchTaskRow> {
  const result = await database.query<ResearchTaskRow>(
    `SELECT id, public_id, question, network_context, attempts, expires_at
     FROM expert_tasks
     WHERE public_id = $1
       AND lease_token_hash = $2
       AND lease_until > now()
       AND status IN ('researching', 'claimed')`,
    [publicId, sha256(leaseToken)],
  )
  const task = result.rows[0]
  if (!task) throw new Error('RESEARCH_LEASE_INVALID')
  return task
}

export async function heartbeatResearchTask(
  database: Database,
  config: AppConfig,
  publicId: string,
  leaseToken: string,
): Promise<Record<string, unknown>> {
  const result = await database.query<{ lease_until: string }>(
    `UPDATE expert_tasks
        SET heartbeat_at = now(),
            lease_until = now() + make_interval(secs => $3),
            updated_at = now()
      WHERE public_id = $1
        AND lease_token_hash = $2
        AND lease_until > now()
        AND status IN ('researching', 'claimed')
      RETURNING lease_until`,
    [publicId, sha256(leaseToken), config.taskLeaseSeconds],
  )
  if (!result.rows[0]) throw new Error('RESEARCH_LEASE_INVALID')
  return {
    task_id: publicId,
    status: 'researching',
    lease_until: result.rows[0].lease_until
  }
}

export async function requestResearchInput(
  database: Database,
  publicId: string,
  leaseToken: string,
  question: string,
): Promise<Record<string, unknown>> {
  const task = await loadLeasedTask(database, publicId, leaseToken)
  await withTransaction(database, async (client) => {
    await client.query(
      `INSERT INTO task_messages (
         task_id, direction, body
       )
       VALUES ($1, 'researcher_to_client', $2)`,
      [task.id, question],
    )
    await client.query(
      `UPDATE expert_tasks
          SET status = 'input_required',
              input_request = $2,
              lease_token_hash = NULL,
              lease_until = NULL,
              updated_at = now()
        WHERE id = $1`,
      [task.id, question],
    )
    await client.query(
      `INSERT INTO task_public_events (
         task_id, stage, progress_percent, public_message
       )
       VALUES (
         $1,
         'researching',
         35,
         'Research paused until the requester supplies bounded clarification.'
       )`,
      [task.id],
    )
  })
  return { task_id: publicId, status: 'input_required' }
}

export async function submitCandidateRevision(
  database: Database,
  input: CandidateRevision,
): Promise<Record<string, unknown>> {
  const candidate = candidateRevisionSchema.parse(input)
  const task = await loadLeasedTask(
    database,
    candidate.task_id,
    candidate.lease_token,
  )
  await Promise.all(
    candidate.provenance.map((source) =>
      assertSafeProvenanceUrl(source.url),
    ),
  )

  const safeCandidate = {
    ...candidate,
    lease_token: undefined
  }
  const serialized = JSON.stringify(safeCandidate)
  const contentHash = sha256Label(serialized)

  await withTransaction(database, async (client) => {
    await client.query(
      `INSERT INTO task_artifacts (
         task_id, artifact_type, payload, content_hash
       )
       VALUES ($1, 'candidate_revision', $2::jsonb, $3)`,
      [task.id, serialized, contentHash],
    )
    await client.query(
      `UPDATE expert_tasks
          SET status = 'validating',
              lease_token_hash = NULL,
              lease_until = NULL,
              updated_at = now()
        WHERE id = $1`,
      [task.id],
    )
    await client.query(
      `INSERT INTO task_public_events (
         task_id, stage, progress_percent, public_message
       )
       VALUES (
         $1,
         'validating',
         60,
         'Candidate knowledge submitted to the deterministic policy gate.'
       )`,
      [task.id],
    )
  })

  return {
    task_id: candidate.task_id,
    status: 'validating',
    artifact_hash: contentHash,
    publication: 'worker_policy_gate'
  }
}

export async function failResearchTask(
  database: Database,
  publicId: string,
  leaseToken: string,
  failureCode: string,
  failureMessage: string,
): Promise<Record<string, unknown>> {
  const task = await loadLeasedTask(database, publicId, leaseToken)
  await database.query(
    `WITH inserted_event AS (
       INSERT INTO task_public_events (
         task_id, stage, progress_percent, public_message
       )
       VALUES ($1, 'failed', 100, 'Research ended without publishable knowledge.')
     )
     UPDATE expert_tasks
        SET status = 'failed',
            failure_code = $2,
            failure_message = $3,
            lease_token_hash = NULL,
            lease_until = NULL,
            completed_at = now(),
            updated_at = now()
      WHERE id = $1`,
    [task.id, failureCode, failureMessage],
  )
  return { task_id: publicId, status: 'failed' }
}

export async function proposeCodeChange(
  database: Database,
  input: {
    task_id?: string | undefined
    summary: string
    proposed_diff: string
    risk_assessment: string
    requested_by: string
  },
): Promise<Record<string, unknown>> {
  const result = await database.query<{ id: string; created_at: string }>(
    `INSERT INTO code_change_approvals (
       task_id,
       repository,
       summary,
       proposed_diff,
       risk_assessment,
       requested_by
     )
     SELECT
       et.id,
       'SmartRoot7/clideck-mcp',
       $2,
       $3,
       $4,
       $5
     FROM (SELECT $1::text AS public_id) requested
     LEFT JOIN expert_tasks et ON et.public_id = requested.public_id
     WHERE $1::text IS NULL OR et.id IS NOT NULL
     RETURNING id, created_at`,
    [
      input.task_id ?? null,
      input.summary,
      input.proposed_diff,
      input.risk_assessment,
      input.requested_by
    ],
  )
  const row = result.rows[0]
  if (!row) throw new Error('EXPERT_TASK_NOT_FOUND')
  return {
    approval_id: row.id,
    status: 'approval_required',
    repository: 'SmartRoot7/clideck-mcp',
    created_at: row.created_at
  }
}
