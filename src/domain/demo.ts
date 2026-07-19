import {
  publicDemoSnapshotSchema,
  type PublicDemoSnapshot
} from '@clideck/demo-contracts'
import {
  coverageTargetsSchema,
  overviewSchema,
  pipelineDetailsSchema,
  qualitySchema
} from '@clideck/admin-contracts'

import type { Database } from '../db.js'
import {
  getAdminOverview,
  getPipelineDetails,
  getQualityDashboard,
  listCoverageTargets
} from './admin.js'

export async function getPublicDemoSnapshot(
  database: Database,
): Promise<PublicDemoSnapshot> {
  const [
    summary,
    hourly,
    growth,
    funnel,
    domains,
    coverage,
    efficiency,
    evaluation,
    engineeringSample,
    networkSample,
    rawOverview,
    rawCoverageTargets,
    rawPipeline,
    rawQuality
  ] = await Promise.all([
    database.query<{
      sequence: number
      published_at: string | Date
      published_knowledge: number
      domains: number
      pipeline_enabled: boolean
      configured_luna: number
      active_luna: number
      active_stage: string | null
      healthy_workers: number
      total_workers: number
    }>(
      `SELECT
         release.sequence::int,
         release.created_at AS published_at,
         (
           SELECT count(*)::int
           FROM release_items
           WHERE release_id = active.release_id
         ) AS published_knowledge,
         (
           SELECT count(DISTINCT item.domain_id)::int
           FROM release_items release_item
           JOIN knowledge_items item
             ON item.id = release_item.knowledge_item_id
           WHERE release_item.release_id = active.release_id
         ) AS domains,
         settings.enabled AS pipeline_enabled,
         settings.max_concurrent_ai_runs::int AS configured_luna,
         (
           SELECT count(*)::int
           FROM pipeline_tasks
           WHERE status IN ('claimed', 'running')
             AND task_type IN (
               'expert_research',
               'candidate_verification',
               'fragment_analysis',
               'source_discovery',
               'source_refresh'
             )
         ) AS active_luna,
         (
           SELECT stage
           FROM pipeline_tasks
           WHERE status IN ('claimed', 'running')
           ORDER BY priority DESC, created_at
           LIMIT 1
         ) AS active_stage,
         (
           SELECT count(*)::int
           FROM worker_heartbeats
           WHERE heartbeat_at >= now() - interval '2 minutes'
         ) AS healthy_workers,
         (SELECT count(*)::int FROM worker_heartbeats) AS total_workers
       FROM active_release active
       JOIN releases release ON release.id = active.release_id
       CROSS JOIN pipeline_settings settings
       WHERE active.singleton AND settings.singleton`,
    ),
    database.query<{ hour: string | Date; published: number }>(
      `WITH hours AS (
         SELECT generate_series(
           date_trunc('hour', now()) - interval '23 hours',
           date_trunc('hour', now()),
           interval '1 hour'
         ) AS hour
       ),
       publications AS (
         SELECT
           date_trunc('hour', updated_at) AS hour,
           count(*)::int AS published
         FROM knowledge_candidates
         WHERE status = 'published'
           AND updated_at >=
             date_trunc('hour', now()) - interval '23 hours'
         GROUP BY date_trunc('hour', updated_at)
       )
       SELECT
         hours.hour,
         coalesce(publications.published, 0)::int AS published
       FROM hours
       LEFT JOIN publications ON publications.hour = hours.hour
       ORDER BY hours.hour`,
    ),
    database.query<{
      day: string | Date
      published: number
      queries: number
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
           SELECT count(*)::int
           FROM knowledge_candidates candidate
           WHERE candidate.status = 'published'
             AND candidate.updated_at::date = days.day
         ), 0) AS published,
         coalesce((
           SELECT sum(usage.request_count)::int
           FROM public_usage_daily usage
           WHERE usage.day = days.day
             AND usage.outcome = 'success'
             AND usage.operation IN (
               'query_network_knowledge',
               'get_network_workflow',
               'query_domain_knowledge'
             )
         ), 0) AS queries,
         coalesce((
           SELECT count(*)::int
           FROM public_lab_validation_summary validation
           WHERE validation.executed_at::date = days.day
             AND validation.status = 'passed'
         ), 0) AS lab_validations
       FROM days
       ORDER BY days.day`,
    ),
    database.query<{
      stage: string
      queued: number
      running: number
      completed: number
      failed: number
    }>(
      `WITH stages(stage, ordinal) AS (
         SELECT *
         FROM unnest(
           ARRAY[
             'discover',
             'acquire',
             'convert',
             'chunk',
             'analyze',
             'verify',
             'publish'
           ]::text[]
         ) WITH ORDINALITY
       )
       SELECT
         stages.stage,
         count(task.id) FILTER (WHERE task.status = 'queued')::int AS queued,
         count(task.id) FILTER (
           WHERE task.status IN ('claimed', 'running')
         )::int AS running,
         count(task.id) FILTER (WHERE task.status = 'completed')::int
           AS completed,
         count(task.id) FILTER (WHERE task.status = 'failed')::int AS failed
       FROM stages
       LEFT JOIN pipeline_tasks task
         ON task.stage = stages.stage
        AND coalesce(task.completed_at, task.updated_at, task.created_at)
          >= now() - interval '24 hours'
       GROUP BY stages.stage, stages.ordinal
       ORDER BY stages.ordinal`,
    ),
    database.query<{
      id: string
      name: string
      records: number
      record_types: number
    }>(
      `SELECT
         pack.id,
         pack.display_name AS name,
         count(active.revision_id)::int AS records,
         count(DISTINCT active.record_type)::int AS record_types
       FROM domain_packs pack
       LEFT JOIN public_active_domain_knowledge active
         ON active.domain_id = pack.id
       WHERE pack.enabled
       GROUP BY pack.id, pack.display_name
       ORDER BY records DESC, pack.id`,
    ),
    database.query<{ dimension: string; key: string; count: number }>(
      `SELECT dimension, key, count
       FROM (
         SELECT
           'vendor'::text AS dimension,
           vendor_slug AS key,
           count(*)::int AS count
         FROM public_active_knowledge
         GROUP BY vendor_slug
         UNION ALL
         SELECT
           'operating_system',
           coalesce(operating_system_slug, 'vendor-level'),
           count(*)::int
         FROM public_active_knowledge
         GROUP BY operating_system_slug
         UNION ALL
         SELECT
           'risk',
           risk_level,
           count(*)::int
         FROM public_active_knowledge
         GROUP BY risk_level
       ) slices
       ORDER BY dimension, count DESC, key`,
    ),
    database.query<{
      tokens_24h: number
      tokens_per_published_revision: string | number
      known_answers: number
      expert_answers: number
    }>(
      `SELECT
         coalesce((
           SELECT sum(
             input_tokens + output_tokens + reasoning_output_tokens
           )::bigint
           FROM agent_runs
           WHERE started_at >= now() - interval '24 hours'
         ), 0) AS tokens_24h,
         coalesce((
           SELECT
             sum(input_tokens + output_tokens + reasoning_output_tokens)
             / nullif(sum(published_revisions), 0)
           FROM agent_runs
         ), 0)::numeric(16,2) AS tokens_per_published_revision,
         coalesce((
           SELECT sum(request_count)::int
           FROM public_usage_daily
           WHERE outcome = 'success'
             AND operation IN (
               'query_network_knowledge',
               'get_network_workflow',
               'query_domain_knowledge'
             )
         ), 0) AS known_answers,
         (SELECT count(*)::int FROM expert_tasks WHERE status = 'completed')
           AS expert_answers`,
    ),
    database.query<{
      suite: string
      case_count: number
      passed_count: number
      failed_count: number
      dangerous_false_safe: number
      p95_ms: string | number
      executed_at: string | Date
    }>('SELECT * FROM public_latest_eval_result'),
    database.query<{
      domain_id: string
      record_type: string
      title: string
      summary: string
      context: Record<string, unknown>
      payload: Record<string, unknown>
      confidence: number
      last_verified_at: string | Date
    }>(
      `SELECT
         domain_id,
         record_type,
         title,
         summary,
         domain_context AS context,
         domain_payload AS payload,
         confidence,
         last_verified_at
       FROM public_active_domain_knowledge
       WHERE domain_id = 'engineering-measurements'
         AND stable_key =
           'engineering-measurements.measurement.demo-block-length'
       LIMIT 1`,
    ),
    database.query<{
      domain_id: string
      record_type: string
      title: string
      summary: string
      context: Record<string, unknown>
      payload: Record<string, unknown>
      confidence: number
      last_verified_at: string | Date
    }>(
      `SELECT
         'network'::text AS domain_id,
         kind AS record_type,
         title,
         summary,
         jsonb_build_object(
           'vendor', vendor_slug,
           'model', platform_slug,
           'operating_system', operating_system_slug,
           'version_min', version_min,
           'version_max', version_max
         ) AS context,
         jsonb_strip_nulls(jsonb_build_object(
           'cli_mode', cli_mode,
           'command', command_text,
           'procedure', procedure_steps,
           'verification', verification_steps,
           'limitations', limitations
         )) AS payload,
         confidence,
         last_verified_at
       FROM public_active_knowledge
       WHERE stable_key = 'cisco.ios-xe.show-ip-interface-brief'
       LIMIT 1`,
    ),
    getAdminOverview(database, null),
    listCoverageTargets(database),
    getPipelineDetails(database),
    getQualityDashboard(database)
  ])

  const summaryRow = summary.rows[0]
  if (!summaryRow) throw new Error('NO_ACTIVE_RELEASE')
  const hourlyRows = hourly.rows
  const efficiencyRow = efficiency.rows[0] ?? {
    tokens_24h: 0,
    tokens_per_published_revision: 0,
    known_answers: 0,
    expert_answers: 0
  }
  const answered =
    Number(efficiencyRow.known_answers) +
    Number(efficiencyRow.expert_answers)
  const slices = (dimension: string) =>
    coverage.rows
      .filter((row) => row.dimension === dimension)
      .slice(0, 8)
      .map(({ key, count }) => ({ key, count }))
  const evaluationRow = evaluation.rows[0]
  const asJson = (value: unknown): unknown =>
    JSON.parse(JSON.stringify(value)) as unknown
  const overview = overviewSchema.parse(asJson(rawOverview))
  const coverageTargets = coverageTargetsSchema.parse(
    asJson(rawCoverageTargets),
  )
  const pipeline = pipelineDetailsSchema.parse(asJson(rawPipeline))
  const quality = qualitySchema.parse(asJson(rawQuality))
  const safeBreakdown = (
    rows: Array<{ key: string; count: string | number }>,
  ) => rows.map((row) => ({ key: row.key, count: row.count }))

  return publicDemoSnapshotSchema.parse({
    generated_at: new Date().toISOString(),
    system: {
      status: !summaryRow.pipeline_enabled
        ? 'paused'
        : Number(summaryRow.healthy_workers) > 0
          ? 'healthy'
          : 'degraded',
      pipeline_enabled: summaryRow.pipeline_enabled,
      healthy_workers: summaryRow.healthy_workers,
      total_workers: summaryRow.total_workers,
      configured_luna: summaryRow.configured_luna,
      active_luna: summaryRow.active_luna,
      active_stage: summaryRow.active_stage
    },
    release: {
      sequence: summaryRow.sequence,
      published_at: summaryRow.published_at,
      published_knowledge: summaryRow.published_knowledge,
      domains: summaryRow.domains,
      published_24h: hourlyRows.reduce(
        (total, row) => total + Number(row.published),
        0,
      )
    },
    published_hourly_24h: hourlyRows,
    growth_30d: growth.rows,
    operations: {
      ai_model: overview.ai_model,
      reasoning_effort: overview.reasoning_effort,
      pipeline_updated_at: overview.pipeline_updated_at,
      sources_total: overview.sources_total,
      sources_completed: overview.sources_completed,
      fragments_total: overview.fragments_total,
      candidates_total: overview.candidates_total,
      failures_24h: overview.failures_24h,
      completed_stages_24h: overview.completed_stages_24h,
      tokens_total: overview.tokens_total,
      tokens_today: overview.tokens_today,
      tokens_per_revision: overview.tokens_per_revision,
      queued_expert: overview.queued_expert,
      queued_verify: overview.queued_verify,
      queued_analyze: overview.queued_analyze,
      queued_discover: overview.queued_discover,
      queued_tasks: overview.queued_tasks,
      open_conflicts: overview.open_conflicts,
      feedback_24h: overview.feedback_24h,
      executors: overview.processes
        .filter((process) =>
          process.worker_name.startsWith('pipeline-executor-'),
        )
        .slice(0, 4)
        .map((process) => ({
          id: process.worker_name,
          healthy: process.healthy,
          heartbeat_at: process.heartbeat_at,
          state: String(
            process.metadata['state'] ??
            process.metadata['status'] ??
            (process.healthy ? 'active' : 'standby'),
          ),
          stage: String(
            process.metadata['stage'] ??
            process.metadata['task_type'] ??
            'standby',
          )
        })),
      activity_30d: overview.activity_30d,
      breakdowns: {
        vendor: safeBreakdown(overview.breakdowns.vendor),
        operating_system:
          safeBreakdown(overview.breakdowns.operating_system),
        risk: safeBreakdown(overview.breakdowns.risk),
        origin: safeBreakdown(overview.breakdowns.origin)
      }
    },
    pipeline_funnel: funnel.rows,
    coverage: {
      domains: domains.rows,
      vendors: slices('vendor'),
      operating_systems: slices('operating_system'),
      risks: slices('risk'),
      targets: coverageTargets.map((target) => ({
        vendor_slug: target.vendor_slug,
        product_family: target.product_family,
        model: target.model,
        operating_system_slug: target.operating_system_slug,
        version_branch: target.version_branch,
        document_role: target.document_role,
        status: target.status,
        priority: target.priority,
        coverage_percent: target.coverage_percent,
        next_check_at: target.next_check_at,
        last_discovered_at: target.last_discovered_at,
        last_completed_at: target.last_completed_at,
        source_count: target.source_count,
        completed_sources: target.completed_sources,
        failed_sources: target.failed_sources,
        created_at: target.created_at,
        updated_at: target.updated_at
      }))
    },
    pipeline_tasks: pipeline.tasks.map((task) => ({
      task_type: task.task_type,
      stage: task.stage,
      status: task.status,
      priority: task.priority,
      lease_until: task.lease_until,
      heartbeat_at: task.heartbeat_at,
      attempts: task.attempts,
      created_at: task.created_at,
      updated_at: task.updated_at,
      completed_at: task.completed_at
    })),
    efficiency: {
      tokens_24h: efficiencyRow.tokens_24h,
      tokens_per_published_revision:
        efficiencyRow.tokens_per_published_revision,
      no_ai_answer_rate: answered === 0
        ? 1
        : Number(efficiencyRow.known_answers) / answered
    },
    evaluation: evaluationRow
      ? {
          suite: evaluationRow.suite,
          cases: evaluationRow.case_count,
          passed: evaluationRow.passed_count,
          failed: evaluationRow.failed_count,
          dangerous_false_safe: evaluationRow.dangerous_false_safe,
          p95_ms: evaluationRow.p95_ms,
          executed_at: evaluationRow.executed_at
        }
      : null,
    quality: {
      summary: quality.summary,
      eval_runs: quality.eval_runs.map((run) => ({
        suite: run.suite,
        case_count: run.case_count,
        passed_count: run.passed_count,
        failed_count: run.failed_count,
        dangerous_false_safe: run.dangerous_false_safe,
        p50_ms: run.p50_ms,
        p95_ms: run.p95_ms,
        max_ms: run.max_ms,
        executed_at: run.executed_at
      })),
      operation_latency_30d: quality.operation_latency_30d,
      conflicts: quality.conflicts
    },
    samples: [
      ...engineeringSample.rows,
      ...networkSample.rows
    ]
  })
}
