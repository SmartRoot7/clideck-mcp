import type { Database } from '../db.js'

export type UsageOutcome =
  | 'success'
  | 'unknown'
  | 'error'
  | 'blocked'
  | 'rate_limited'

export async function recordPublicUsage(
  database: Database,
  operation: string,
  outcome: UsageOutcome,
  durationMs: number,
): Promise<void> {
  await database.query(
    `INSERT INTO public_usage_daily (
       day, operation, outcome, request_count, total_duration_ms
     )
     VALUES (current_date, $1, $2, 1, $3)
     ON CONFLICT (day, operation, outcome)
     DO UPDATE SET
       request_count = public_usage_daily.request_count + 1,
       total_duration_ms =
         public_usage_daily.total_duration_ms + excluded.total_duration_ms`,
    [operation, outcome, Math.max(0, Math.round(durationMs))],
  )
}

export async function getPublicStats(database: Database) {
  const [coverage, usage, growth, evaluation] = await Promise.all([
    database.query<{
      release_sequence: number
      release_published_at: string | Date
      published_knowledge: number
      deep_vendors: number
      recognized_vendors: number
      device_models: number
      operating_systems: number
      version_scopes: number
      workflows: number
      lab_validated_revisions: number
    }>(
      `SELECT
         r.sequence::int AS release_sequence,
         r.published_at AS release_published_at,
         (SELECT count(*)::int FROM public_active_knowledge) AS published_knowledge,
         (
           SELECT count(DISTINCT p.vendor_id)::int
           FROM device_models dm
           JOIN platforms p ON p.id = dm.platform_id
           WHERE dm.support_level = 'deep'
         ) AS deep_vendors,
         (
           SELECT count(DISTINCT p.vendor_id)::int
           FROM device_models dm
           JOIN platforms p ON p.id = dm.platform_id
         ) AS recognized_vendors,
         (SELECT count(*)::int FROM device_models) AS device_models,
         (
           SELECT count(DISTINCT operating_system_slug)::int
           FROM public_active_knowledge
         ) AS operating_systems,
         (
           SELECT count(DISTINCT concat_ws(
             ':', operating_system_slug, version_min, version_max
           ))::int
           FROM public_active_knowledge
         ) AS version_scopes,
         (
           SELECT count(*)::int
           FROM public_active_knowledge
           WHERE kind IN ('workflow', 'change', 'upgrade')
         ) AS workflows,
         (
           SELECT count(DISTINCT revision_id)::int
           FROM public_lab_validation_summary
           WHERE status = 'passed'
             AND expires_at > now()
             AND validation_type IN ('batfish_modeled', 'runtime_lab_validated')
         ) AS lab_validated_revisions
       FROM public_active_release_summary r`,
    ),
    database.query<{
      known_answers_served: number
      expert_answers_published: number
    }>(
      `SELECT
         coalesce(sum(request_count) FILTER (
           WHERE operation IN ('query_network_knowledge', 'get_network_workflow')
             AND outcome = 'success'
         ), 0)::int AS known_answers_served,
         (SELECT count(*)::int FROM expert_tasks WHERE status = 'completed')
           AS expert_answers_published
       FROM public_usage_daily`,
    ),
    database.query<{
      day: string | Date
      answers: number
      new_knowledge: number
      lab_validations: number
    }>(
      `WITH days AS (
         SELECT generate_series(
           current_date - 29,
           current_date,
           interval '1 day'
         )::date AS day
       )
       SELECT
         days.day,
         coalesce((
           SELECT sum(pud.request_count)::int
           FROM public_usage_daily pud
           WHERE pud.day = days.day
             AND pud.operation IN (
               'query_network_knowledge',
               'get_network_workflow'
             )
             AND pud.outcome = 'success'
         ), 0) AS answers,
         coalesce((
           SELECT count(*)::int
           FROM public_active_knowledge pak
           WHERE pak.revision_created_at::date = days.day
         ), 0) AS new_knowledge,
         coalesce((
           SELECT count(*)::int
           FROM public_lab_validation_summary kv
           WHERE kv.executed_at::date = days.day
             AND kv.status = 'passed'
         ), 0) AS lab_validations
       FROM days
       ORDER BY days.day`,
    ),
    database.query<{
      suite: string
      commit_sha: string | null
      case_count: number
      passed_count: number
      failed_count: number
      dangerous_false_safe: number
      p50_ms: string
      p95_ms: string
      max_ms: string
      executed_at: string | Date
    }>(
      `SELECT *
       FROM public_latest_eval_result`,
    )
  ])

  const coverageRow = coverage.rows[0]
  const usageRow = usage.rows[0] ?? {
    known_answers_served: 0,
    expert_answers_published: 0
  }
  if (!coverageRow) throw new Error('NO_ACTIVE_RELEASE')
  const totalAnswers =
    usageRow.known_answers_served + usageRow.expert_answers_published

  return {
    generated_at: new Date().toISOString(),
    active_release: {
      sequence: coverageRow.release_sequence,
      published_at: new Date(coverageRow.release_published_at).toISOString()
    },
    coverage: {
      published_knowledge: coverageRow.published_knowledge,
      deep_vendors: coverageRow.deep_vendors,
      recognized_vendors: coverageRow.recognized_vendors,
      device_models: coverageRow.device_models,
      operating_systems: coverageRow.operating_systems,
      version_scopes: coverageRow.version_scopes,
      workflows: coverageRow.workflows,
      lab_validated_revisions: coverageRow.lab_validated_revisions
    },
    usage: {
      known_answers_served: usageRow.known_answers_served,
      expert_answers_published: usageRow.expert_answers_published,
      no_ai_answer_rate:
        totalAnswers === 0
          ? 1
          : Math.round(
              (usageRow.known_answers_served / totalAnswers) * 10_000,
            ) / 10_000
    },
    evaluation: evaluation.rows[0]
      ? {
          suite: evaluation.rows[0].suite,
          commit_sha: evaluation.rows[0].commit_sha,
          cases: evaluation.rows[0].case_count,
          passed: evaluation.rows[0].passed_count,
          failed: evaluation.rows[0].failed_count,
          dangerous_false_safe:
            evaluation.rows[0].dangerous_false_safe,
          latency_ms: {
            p50: Number(evaluation.rows[0].p50_ms),
            p95: Number(evaluation.rows[0].p95_ms),
            max: Number(evaluation.rows[0].max_ms)
          },
          executed_at: new Date(
            evaluation.rows[0].executed_at,
          ).toISOString()
        }
      : null,
    growth_30d: growth.rows.map((row) => ({
      day: new Date(row.day).toISOString().slice(0, 10),
      answers: row.answers,
      new_knowledge: row.new_knowledge,
      lab_validations: row.lab_validations
    }))
  }
}
