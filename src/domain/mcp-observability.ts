import { isIP } from 'node:net'

import type { Database } from '../db.js'
import { sha256 } from '../crypto.js'
import type { PublicActor } from './auth.js'
import { resolveNetworkContext } from './context.js'
import { sanitizeSnapshot } from './snapshot.js'

const redacted = 'XXXXXXXX'
const maxDepth = 8
const maxStringLength = 8_000
const maxArrayLength = 200
const maxObjectKeys = 200

const secretKeys = /(?:^|_)(?:access_token|verification_token|authorization|api_key|password|private_key|secret|session|cookie|credential)(?:_|$)/i
const privateEvidenceKeys = /^(?:provenance|evidence_fragment|source_url|canonical_url|manual_title|document_title)$/i

export type McpRequestOutcome =
  | 'success'
  | 'unknown'
  | 'blocked'
  | 'error'
  | 'rate_limited'

function sanitizeScalarString(value: string): string {
  return sanitizeSnapshot(
    value.replaceAll('\u0000', '').slice(0, maxStringLength),
    'strict',
  ).sanitized
}

function projectValue(
  value: unknown,
  depth = 0,
  key = '',
): unknown {
  if (secretKeys.test(key) || privateEvidenceKeys.test(key)) return redacted
  if (value === null || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null
  }
  if (typeof value === 'string') return sanitizeScalarString(value)
  if (depth >= maxDepth) return '[TRUNCATED_DEPTH]'
  if (Array.isArray(value)) {
    return value.slice(0, maxArrayLength).map(
      (entry) => projectValue(entry, depth + 1),
    )
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entryValue]) => entryValue !== undefined)
        .slice(0, maxObjectKeys)
        .map(([entryKey, entryValue]) => [
          entryKey,
          projectValue(entryValue, depth + 1, entryKey),
        ]),
    )
  }
  return String(value)
}

function boundedPayload(
  value: unknown,
  maxBytes: number,
): Record<string, unknown> | unknown[] {
  const projected = projectValue(value)
  const normalized =
    projected && typeof projected === 'object'
      ? projected as Record<string, unknown> | unknown[]
      : { value: projected }
  const serialized = JSON.stringify(normalized)
  if (Buffer.byteLength(serialized, 'utf8') <= maxBytes) return normalized
  return {
    truncated: true,
    preview: sanitizeScalarString(serialized.slice(0, maxBytes - 512))
  }
}

export function sanitizeMcpLogPayload(
  value: unknown,
  maxBytes = 64 * 1_024,
): Record<string, unknown> | unknown[] {
  return boundedPayload(value, maxBytes)
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, stableValue(entry)]),
  )
}

function preview(value: unknown, maxLength: number): string {
  const serialized =
    typeof value === 'string' ? value : JSON.stringify(value)
  return sanitizeScalarString(serialized).slice(0, maxLength)
}

function recordOf(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

export function classifyMcpOutcome(output: unknown): McpRequestOutcome {
  const value = recordOf(output)
  if (
    value?.['answer_status'] === 'partial' ||
    value?.['answer_status'] === 'unknown' ||
    value?.['unknown'] === true ||
    value?.['status'] === 'unknown' ||
    value?.['decision'] === 'unknown'
  ) {
    return 'unknown'
  }
  return value?.['decision'] === 'blocked' ? 'blocked' : 'success'
}

export function extractMcpQuestion(
  toolName: string,
  input: unknown,
): string {
  const value = recordOf(input)
  for (const key of ['question', 'goal', 'intent']) {
    if (typeof value?.[key] === 'string') {
      return sanitizeScalarString(value[key]).slice(0, 1_000)
    }
  }
  return preview({ tool: toolName, input }, 1_000)
}

type PreparedKnowledgeDemand = {
  question: string
  context: Record<string, unknown>
  demandKey: Buffer
}

async function prepareKnowledgeDemand(
  database: Database,
  toolName: string,
  input: unknown,
  output: unknown,
): Promise<PreparedKnowledgeDemand | null> {
  if (![
    'query_network_knowledge',
    'get_network_workflow',
    'query_domain_knowledge',
    'review_network_change',
    'advise_network_upgrade'
  ].includes(toolName)) {
    return null
  }
  const outputRecord = recordOf(output)
  if (!outputRecord) return null
  if (
    toolName === 'query_domain_knowledge' &&
    outputRecord['domain_id'] !== 'network'
  ) {
    return null
  }
  const inputRecord = recordOf(input)
  const questionValue = toolName === 'get_network_workflow'
    ? inputRecord?.['goal']
    : toolName === 'review_network_change'
      ? inputRecord?.['intent']
      : toolName === 'advise_network_upgrade'
        ? [
            'Upgrade',
            inputRecord?.['model'],
            inputRecord?.['operating_system'],
            'from',
            inputRecord?.['current_version'],
            'to',
            inputRecord?.['target_version']
          ].filter((value) => typeof value === 'string').join(' ')
        : inputRecord?.['question']
  let contextValue = recordOf(outputRecord['context'])
  if (
    !contextValue ||
    typeof contextValue['vendor_slug'] !== 'string' ||
    typeof contextValue['operating_system_slug'] !== 'string'
  ) {
    const applicability = recordOf(outputRecord['applicability'])
    const rawContext =
      recordOf(inputRecord?.['context']) ??
      (applicability
        ? {
            vendor: applicability['vendor'],
            model: applicability['model'],
            operating_system: applicability['operating_system'],
            version: applicability['current_version']
          }
        : null)
    if (rawContext) {
      const resolved = await resolveNetworkContext(database, {
        ...(typeof rawContext['vendor'] === 'string'
          ? { vendor: rawContext['vendor'] }
          : {}),
        ...(typeof rawContext['model'] === 'string'
          ? { model: rawContext['model'] }
          : {}),
        ...(typeof rawContext['operating_system'] === 'string'
          ? { operating_system: rawContext['operating_system'] }
          : {}),
        ...(typeof rawContext['version'] === 'string'
          ? { version: rawContext['version'] }
          : {})
      })
      contextValue = {
        vendor: resolved.vendor,
        vendor_slug: resolved.vendor_slug,
        model: resolved.model,
        platform_slug: resolved.platform_slug,
        operating_system: resolved.operating_system,
        operating_system_slug: resolved.operating_system_slug,
        runtime_mode: resolved.runtime_mode,
        shell_environment: resolved.shell_environment,
        version: resolved.version,
        applicable_version: resolved.applicable_version
      }
    }
  }
  if (
    typeof questionValue !== 'string' ||
    !contextValue ||
    typeof contextValue['vendor_slug'] !== 'string' ||
    typeof contextValue['operating_system_slug'] !== 'string'
  ) {
    return null
  }
  contextValue = {
    vendor: contextValue['vendor'],
    vendor_slug: contextValue['vendor_slug'],
    model: contextValue['model'],
    platform_slug: contextValue['platform_slug'],
    operating_system: contextValue['operating_system'],
    operating_system_slug: contextValue['operating_system_slug'],
    software_family: contextValue['software_family'],
    software_family_slug: contextValue['software_family_slug'],
    runtime_mode: contextValue['runtime_mode'],
    shell_environment: contextValue['shell_environment'],
    version: contextValue['version'],
    applicable_version: contextValue['applicable_version'],
    initial_answer_status: outputRecord['answer_status'] ?? (
      outputRecord['unknown'] === true ? 'unknown' : 'complete'
    ),
    initial_coverage: outputRecord['coverage'] ?? [],
    initial_answers: Array.isArray(outputRecord['answers'])
      ? outputRecord['answers'].slice(0, 5).map((answer) => {
          const record = recordOf(answer)
          return record
            ? {
                revision_ref: record['revision_ref'],
                title: record['title'],
                summary: record['summary'],
                command: record['command'],
                procedure: record['procedure'],
                limitations: record['limitations'],
                applicability: record['applicability']
              }
            : null
        }).filter(Boolean)
      : []
  }
  const question = sanitizeScalarString(questionValue).slice(0, 2_000)
  if (question.length < 3) return null
  const context = boundedPayload(contextValue, 16_384)
  if (Array.isArray(context)) return null
  const {
    initial_answer_status: _initialAnswerStatus,
    initial_coverage: _initialCoverage,
    initial_answers: _initialAnswers,
    ...canonicalDemandContext
  } = context
  return {
    question,
    context,
    demandKey: sha256(JSON.stringify(stableValue({
      domain_id: 'network',
      question: question.toLocaleLowerCase('en-US'),
      context: canonicalDemandContext
    })))
  }
}

export async function queueUnknownKnowledgeDemand(
  database: Database,
  toolName: string,
  input: unknown,
  output: unknown,
): Promise<string | null> {
  const outputRecord = recordOf(output)
  if (!outputRecord || classifyMcpOutcome(outputRecord) !== 'unknown') {
    return null
  }
  const prepared = await prepareKnowledgeDemand(
    database,
    toolName,
    input,
    output,
  )
  if (!prepared) return null
  const result = await database.query<{
    demand_id: string
  }>(
    `SELECT demand_id
     FROM queue_network_knowledge_demand($1, $2, $3::jsonb, $4)`,
    [
      toolName,
      prepared.question,
      JSON.stringify(prepared.context),
      prepared.demandKey
    ],
  )
  return result.rows[0]?.demand_id ?? null
}

export async function getKnowledgeDemandLearningStatus(
  database: Database,
  demandId: string,
): Promise<'diagnosing' | 'discovering' | 'processing' | 'rechecking' | 'unavailable'> {
  const result = await database.query<{ status: string }>(
    `SELECT status FROM knowledge_demands WHERE id = $1`,
    [demandId],
  )
  switch (result.rows[0]?.status) {
    case 'diagnosing': return 'diagnosing'
    case 'queued':
    case 'discovering': return 'discovering'
    case 'acquiring':
    case 'processing': return 'processing'
    case 'published': return 'rechecking'
    default: return 'unavailable'
  }
}

export async function queueApproximateKnowledgeDemand(
  database: Database,
  toolName: string,
  input: unknown,
  output: unknown,
): Promise<string | null> {
  const outputRecord = recordOf(output)
  if (!outputRecord || classifyMcpOutcome(outputRecord) !== 'success') {
    return null
  }
  const answers = outputRecord['answers']
  const firstAnswer = Array.isArray(answers) ? recordOf(answers[0]) : null
  const applicability = recordOf(firstAnswer?.['applicability'])
  const assurance = applicability?.['assurance_level']
  if (assurance !== 'generic' && assurance !== 'best_effort') return null
  const prepared = await prepareKnowledgeDemand(
    database,
    toolName,
    input,
    output,
  )
  if (!prepared) return null
  const result = await database.query<{ demand_id: string }>(
    `SELECT demand_id
     FROM queue_network_knowledge_gap($1, $2, $3::jsonb, $4)`,
    [
      toolName,
      prepared.question,
      JSON.stringify(prepared.context),
      prepared.demandKey
    ],
  )
  return result.rows[0]?.demand_id ?? null
}

export async function reconcileKnownKnowledgeDemand(
  database: Database,
  toolName: string,
  input: unknown,
  output: unknown,
): Promise<string | null> {
  const outputRecord = recordOf(output)
  if (!outputRecord || classifyMcpOutcome(outputRecord) !== 'success') {
    return null
  }
  const answers = outputRecord['answers']
  const firstAnswer = Array.isArray(answers) ? recordOf(answers[0]) : null
  const revisionRef = firstAnswer?.['revision_ref']
  if (typeof revisionRef !== 'string') return null
  const prepared = await prepareKnowledgeDemand(
    database,
    toolName,
    input,
    output,
  )
  if (!prepared) return null
  const result = await database.query<{ id: string }>(
    `UPDATE knowledge_demands demand
        SET status = 'published',
            result_revision_id = revision.id,
            result_release_id = active.release_id,
            last_error_code = NULL,
            completed_at = now(),
            last_seen_at = now()
       FROM knowledge_revisions revision
       CROSS JOIN active_release active
      WHERE demand.demand_key = $1
        AND revision.public_ref = $2
        AND demand.status <> 'published'
      RETURNING demand.id`,
    [prepared.demandKey, revisionRef],
  )
  return result.rows[0]?.id ?? null
}

export async function recordMcpRequest(
  database: Database,
  input: {
    requestId: string
    clientAddress: string
    actor: PublicActor
    toolName: string
    request: unknown
    response: unknown
    outcome: McpRequestOutcome
    durationMs: number
    knowledgeDemandId?: string | null
    errorCode?: string | null
    retryable?: boolean
  },
): Promise<void> {
  const requestPayload = sanitizeMcpLogPayload(input.request, 64 * 1_024)
  const responsePayload = sanitizeMcpLogPayload(input.response, 128 * 1_024)
  await database.query(
    `INSERT INTO mcp_request_logs (
       request_id,
       client_ip,
       actor_kind,
       tool_name,
       request_payload,
       response_payload,
       question_preview,
       response_preview,
       outcome,
       error_code,
       retryable,
       duration_ms,
       knowledge_demand_id
     )
     VALUES (
       $1,
       $2::inet,
       $3,
       $4,
       $5::jsonb,
       $6::jsonb,
       $7,
       $8,
       $9,
       $10,
       $11,
       $12,
       $13
     )`,
    [
      input.requestId,
      isIP(input.clientAddress) ? input.clientAddress : null,
      input.actor.kind,
      input.toolName,
      JSON.stringify(requestPayload),
      JSON.stringify(responsePayload),
      extractMcpQuestion(input.toolName, requestPayload),
      preview(responsePayload, 2_000),
      input.outcome,
      input.errorCode ?? null,
      input.retryable ?? false,
      Math.max(0, Math.min(2_147_483_647, Math.round(input.durationMs))),
      input.knowledgeDemandId ?? null
    ],
  )
}

export async function purgeExpiredMcpRequestLogs(
  database: Database,
  retentionDays: number,
): Promise<number> {
  const result = await database.query<{ id: string }>(
    `DELETE FROM mcp_request_logs
     WHERE occurred_at < now() - make_interval(days => $1)
     RETURNING id`,
    [retentionDays],
  )
  return result.rowCount ?? 0
}

export async function listMcpRequestLogs(
  database: Database,
  input: {
    limit: number
    offset: number
    tool: string | null
    outcome: string | null
    query: string | null
    queryScope?: 'all' | 'response_only'
  },
): Promise<Record<string, unknown>> {
  const parameters = [
    input.tool,
    input.outcome,
    input.query,
    input.limit,
    input.offset,
    input.queryScope ?? 'all'
  ]
  const result = await database.query(
    `WITH filtered AS (
       SELECT
         log.id,
         log.request_id,
         host(log.client_ip) AS client_ip,
         log.actor_kind,
         log.tool_name,
         log.question_preview,
         log.response_preview,
         log.outcome,
         log.error_code,
         log.retryable,
         log.duration_ms,
         log.knowledge_demand_id,
         demand.status AS learning_status,
         demand.demand_count,
         demand.result_release_id,
         log.occurred_at
       FROM mcp_request_logs log
       LEFT JOIN knowledge_demands demand
         ON demand.id = log.knowledge_demand_id
       WHERE ($1::text IS NULL OR log.tool_name = $1)
         AND ($2::text IS NULL OR log.outcome = $2)
         AND (
           $3::text IS NULL
           OR log.response_preview ILIKE '%' || $3 || '%'
           OR (
             $6 = 'all'
             AND log.question_preview ILIKE '%' || $3 || '%'
           )
         )
     )
     SELECT
       filtered.*,
       count(*) OVER ()::int AS total
     FROM filtered
     ORDER BY occurred_at DESC, id DESC
     LIMIT $4 OFFSET $5`,
    parameters,
  )
  let total = result.rows[0]?.total
  if (total === undefined && input.offset > 0) {
    const count = await database.query<{ total: number }>(
      `SELECT count(*)::int AS total
       FROM mcp_request_logs log
       WHERE ($1::text IS NULL OR log.tool_name = $1)
         AND ($2::text IS NULL OR log.outcome = $2)
         AND (
           $3::text IS NULL
           OR log.response_preview ILIKE '%' || $3 || '%'
           OR (
             $4 = 'all'
             AND log.question_preview ILIKE '%' || $3 || '%'
           )
         )`,
      [
        input.tool,
        input.outcome,
        input.query,
        input.queryScope ?? 'all'
      ],
    )
    total = count.rows[0]?.total ?? 0
  }
  return {
    items: result.rows.map(({ total: _total, ...row }) => row),
    total: total ?? 0,
    limit: input.limit,
    offset: input.offset
  }
}

export async function getMcpRequestLog(
  database: Database,
  id: string,
): Promise<Record<string, unknown> | null> {
  const result = await database.query(
    `SELECT
       log.id,
       log.request_id,
       host(log.client_ip) AS client_ip,
       log.actor_kind,
       log.tool_name,
       log.request_payload,
       log.response_payload,
       log.question_preview,
       log.response_preview,
       log.outcome,
       log.error_code,
       log.retryable,
       log.duration_ms,
       log.knowledge_demand_id,
       demand.status AS learning_status,
       demand.demand_count,
       demand.first_seen_at,
       demand.last_seen_at,
       release.sequence AS result_release_sequence,
       CASE WHEN demand.id IS NULL THEN NULL ELSE jsonb_build_object(
         'status', coalesce(diagnostic.status, demand.diagnosis_status),
         'failure_class', diagnostic.failure_class,
         'answer_status', coalesce(diagnostic.answer_status, demand.replay_status),
         'canonical_context', coalesce(
           diagnostic.canonical_context, demand.canonical_context, '{}'::jsonb
         ),
         'subquestions', coalesce(diagnostic.subquestions, '[]'::jsonb),
         'missing_capabilities', coalesce(diagnostic.missing_capabilities, '{}'),
         'recommended_action', diagnostic.recommended_action,
         'reasoning_summary', diagnostic.reasoning_summary,
         'topic_slug', topic.topic_slug,
         'topic_state', topic.state,
         'replay_result', diagnostic.replay_result,
         'attempts', coalesce(task.attempts, 0),
         'luna_tokens', coalesce(tokens.total_tokens, 0),
         'completed_at', diagnostic.completed_at
       ) END AS learning_diagnosis,
       log.occurred_at
     FROM mcp_request_logs log
     LEFT JOIN knowledge_demands demand
       ON demand.id = log.knowledge_demand_id
     LEFT JOIN releases release
       ON release.id = demand.result_release_id
     LEFT JOIN LATERAL (
       SELECT * FROM knowledge_demand_diagnostics candidate
        WHERE candidate.knowledge_demand_id = demand.id
        ORDER BY candidate.created_at DESC LIMIT 1
     ) diagnostic ON true
     LEFT JOIN pipeline_tasks task ON task.id = diagnostic.pipeline_task_id
     LEFT JOIN LATERAL (
       SELECT coalesce(sum(
         run.input_tokens + run.output_tokens + run.reasoning_output_tokens
       ), 0)::int AS total_tokens
       FROM agent_runs run
       WHERE run.pipeline_task_id = diagnostic.pipeline_task_id
     ) tokens ON true
     LEFT JOIN LATERAL (
       SELECT * FROM knowledge_demand_topic_memberships candidate
        WHERE candidate.knowledge_demand_id = demand.id
        ORDER BY candidate.created_at DESC LIMIT 1
     ) membership ON true
     LEFT JOIN demand_topics topic ON topic.id = membership.demand_topic_id
     WHERE log.id = $1::bigint`,
    [id],
  )
  return result.rows[0] ?? null
}

export async function getMcpRequestAnalytics(
  database: Database,
): Promise<Record<string, unknown>> {
  const [totals, hourly] = await Promise.all([
    database.query(
      `SELECT
         count(*)::int AS requests,
         count(*) FILTER (WHERE outcome IN ('success', 'blocked'))::int
           AS answered,
         count(*) FILTER (WHERE outcome = 'unknown')::int AS unknown,
         count(*) FILTER (
           WHERE outcome IN ('error', 'rate_limited')
         )::int AS errors
       FROM mcp_request_logs
       WHERE occurred_at >= now() - interval '24 hours'`,
    ),
    database.query(
      `WITH hours AS (
         SELECT generate_series(
           date_trunc('hour', now()) - interval '23 hours',
           date_trunc('hour', now()),
           interval '1 hour'
         ) AS hour
       ),
       counts AS (
         SELECT
           date_trunc('hour', occurred_at) AS hour,
           count(*)::int AS requests,
           count(*) FILTER (
             WHERE outcome IN ('success', 'blocked')
           )::int AS answered,
           count(*) FILTER (WHERE outcome = 'unknown')::int AS unknown,
           count(*) FILTER (
             WHERE outcome IN ('error', 'rate_limited')
           )::int AS errors
         FROM mcp_request_logs
         WHERE occurred_at >= date_trunc('hour', now()) - interval '23 hours'
         GROUP BY 1
       )
       SELECT
         hours.hour,
         coalesce(counts.requests, 0)::int AS requests,
         coalesce(counts.answered, 0)::int AS answered,
         coalesce(counts.unknown, 0)::int AS unknown,
         coalesce(counts.errors, 0)::int AS errors
       FROM hours
       LEFT JOIN counts USING (hour)
       ORDER BY hours.hour`,
    )
  ])
  return {
    totals_24h: totals.rows[0] ?? {
      requests: 0,
      answered: 0,
      unknown: 0,
      errors: 0
    },
    hourly_24h: hourly.rows
  }
}
