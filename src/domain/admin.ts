import type { Database } from '../db.js'
import { withTransaction } from '../db.js'
import { ensurePipelineWork } from './pipeline.js'

export type AdminRole = 'admin' | 'super_admin'

export async function recordAdminAudit(
  database: Database,
  actor: { id: string; role: AdminRole },
  action: string,
  targetType: string,
  targetId: string | null,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  await database.query(
    `INSERT INTO admin_audit_events (
       actor_id, actor_role, action, target_type, target_id, metadata
     )
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
    [
      actor.id,
      actor.role,
      action,
      targetType,
      targetId,
      JSON.stringify(metadata)
    ],
  )
}

export async function getAdminOverview(
  database: Database,
  deployedCommitSha: string | null,
): Promise<Record<string, unknown>> {
  const [
    summary,
    health,
    funnel,
    breakdown,
    activity,
    publishedHourly,
    errors,
    activeTask
  ] = await Promise.all([
    database.query(
      `SELECT
         ar.release_id::text AS active_release,
         r.sequence::int AS active_release_sequence,
         r.created_at AS active_release_created_at,
         (SELECT count(*)::int
          FROM release_items WHERE release_id = ar.release_id)
           AS published_revisions,
         ps.enabled AS pipeline_enabled,
         ps.ai_model,
         ps.reasoning_effort,
         ps.max_concurrent_ai_runs,
         ps.control_generation,
         ps.pause_requested_at,
         ps.paused_reason,
         ps.updated_at AS pipeline_updated_at,
         sc.id AS active_source_id,
         sc.title AS active_source_title,
         sc.status AS active_source_status,
         ct.vendor_slug AS active_vendor,
         ct.operating_system_slug AS active_operating_system,
         ct.document_role AS active_document_role,
         (SELECT count(*)::int FROM expert_tasks WHERE status = 'queued')
           AS queued_tasks,
         (SELECT count(*)::int FROM knowledge_conflicts WHERE status = 'open')
           AS open_conflicts,
         (SELECT count(*)::int FROM feedback
          WHERE created_at >= now() - interval '24 hours') AS feedback_24h,
         (SELECT count(*)::int FROM source_candidates) AS sources_total,
         (SELECT count(*)::int FROM source_candidates
          WHERE status = 'completed') AS sources_completed,
         (SELECT count(*)::int FROM source_fragments) AS fragments_total,
         (SELECT count(*)::int FROM knowledge_candidates) AS candidates_total,
         (SELECT count(*)::int FROM pipeline_tasks
          WHERE status = 'failed'
            AND completed_at >= now() - interval '24 hours') AS failures_24h,
         (SELECT count(*)::int FROM pipeline_tasks
          WHERE status = 'completed'
            AND completed_at >= now() - interval '24 hours')
           AS completed_stages_24h,
         (SELECT coalesce(sum(
            input_tokens + output_tokens + reasoning_output_tokens
          ), 0)::bigint FROM agent_runs) AS tokens_total,
         (SELECT coalesce(sum(
            input_tokens + output_tokens + reasoning_output_tokens
          ), 0)::bigint FROM agent_runs
          WHERE started_at >= date_trunc('day', now())) AS tokens_today,
         (SELECT count(*)::int FROM agent_runs
          WHERE status = 'running') AS active_agent_runs,
         (SELECT count(*)::int FROM pipeline_tasks
          WHERE status IN ('claimed', 'running')
            AND task_type IN (
              'expert_research',
              'source_discovery',
              'fragment_analysis',
              'candidate_verification',
              'source_refresh'
            )) AS active_luna_executors,
         (SELECT count(*)::int FROM pipeline_tasks
          WHERE status = 'queued'
            AND task_type = 'expert_research') AS queued_expert,
         (SELECT count(*)::int FROM pipeline_tasks
          WHERE status = 'queued'
            AND task_type = 'candidate_verification') AS queued_verify,
         (SELECT count(*)::int FROM pipeline_tasks
          WHERE status = 'queued'
            AND task_type = 'fragment_analysis') AS queued_analyze,
         (SELECT count(*)::int FROM pipeline_tasks
          WHERE status = 'queued'
            AND task_type IN ('source_discovery', 'source_refresh'))
           AS queued_discover,
         (SELECT coalesce(
            sum(input_tokens + output_tokens + reasoning_output_tokens)
            / nullif(sum(published_revisions), 0),
            0
          )::numeric(14,2) FROM agent_runs) AS tokens_per_revision
       FROM active_release ar
       JOIN releases r ON r.id = ar.release_id
       CROSS JOIN pipeline_settings ps
       LEFT JOIN source_candidates sc ON sc.id = ps.active_source_id
       LEFT JOIN coverage_targets ct ON ct.id = sc.coverage_target_id
       WHERE ar.singleton AND ps.singleton`,
    ),
    database.query(
      `SELECT worker_name, instance_id, heartbeat_at, metadata,
              (heartbeat_at >= now() - interval '2 minutes') AS healthy
       FROM worker_heartbeats
       ORDER BY worker_name`,
    ),
    database.query(
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
         count(pt.id)::int AS count,
         count(pt.id) FILTER (WHERE pt.status = 'queued')::int AS queued,
         count(pt.id) FILTER (
           WHERE pt.status IN ('claimed', 'running')
         )::int AS running,
         count(pt.id) FILTER (WHERE pt.status = 'completed')::int
           AS completed,
         count(pt.id) FILTER (WHERE pt.status = 'failed')::int AS failed,
         count(pt.id) FILTER (WHERE pt.status = 'cancelled')::int
           AS cancelled,
         count(pt.id) FILTER (WHERE pt.status = 'skipped')::int AS skipped
       FROM stages
       LEFT JOIN pipeline_tasks pt
         ON pt.stage = stages.stage
        AND coalesce(pt.completed_at, pt.updated_at, pt.created_at)
          >= now() - interval '24 hours'
       GROUP BY stages.stage, stages.ordinal
       ORDER BY stages.ordinal`,
    ),
    database.query(
      `SELECT
         CASE
           WHEN grouping(vendor_slug) = 0 THEN 'vendor'
           WHEN grouping(operating_system_slug) = 0 THEN 'operating_system'
           WHEN grouping(risk_level) = 0 THEN 'risk'
           ELSE 'origin'
         END AS dimension,
         CASE
           WHEN grouping(vendor_slug) = 0 THEN vendor_slug
           WHEN grouping(operating_system_slug) = 0
             THEN coalesce(operating_system_slug, 'vendor-level')
           WHEN grouping(risk_level) = 0 THEN risk_level
           ELSE origin
         END AS key,
         count(*)::int AS count
       FROM public_active_knowledge
       GROUP BY GROUPING SETS (
         (vendor_slug),
         (operating_system_slug),
         (risk_level),
         (origin)
       )
       ORDER BY dimension, count DESC`,
    ),
    database.query(
      `WITH days AS (
         SELECT generate_series(
           current_date - 29,
           current_date,
           interval '1 day'
         )::date AS day
       ),
       revision_daily AS (
         SELECT created_at::date AS day, count(*)::int AS count
         FROM knowledge_revisions
         WHERE created_at >= current_date - 29
         GROUP BY created_at::date
       ),
       published_daily AS (
         SELECT updated_at::date AS day, count(*)::int AS count
         FROM knowledge_candidates
         WHERE status = 'published'
           AND updated_at >= current_date - 29
         GROUP BY updated_at::date
       ),
       task_daily AS (
         SELECT completed_at::date AS day, count(*)::int AS count
         FROM pipeline_tasks
         WHERE completed_at >= current_date - 29
           AND status = 'completed'
         GROUP BY completed_at::date
       ),
       agent_daily AS (
         SELECT
           started_at::date AS day,
           sum(
             input_tokens + output_tokens + reasoning_output_tokens
           )::bigint AS tokens
         FROM agent_runs
         WHERE started_at >= current_date - 29
         GROUP BY started_at::date
       )
       SELECT
         d.day,
         coalesce(pd.count, 0) AS published,
         coalesce(rd.count, 0) AS revisions_created,
         coalesce(td.count, 0) AS stages_completed,
         coalesce(ad.tokens, 0) AS tokens
       FROM days d
       LEFT JOIN published_daily pd ON pd.day = d.day
       LEFT JOIN revision_daily rd ON rd.day = d.day
       LEFT JOIN task_daily td ON td.day = d.day
       LEFT JOIN agent_daily ad ON ad.day = d.day
       ORDER BY d.day`,
    ),
    database.query(
      `WITH hours AS (
         SELECT generate_series(
           date_trunc('hour', now()) - interval '23 hours',
           date_trunc('hour', now()),
           interval '1 hour'
         ) AS hour
       ),
       published AS (
         SELECT
           date_trunc('hour', updated_at) AS hour,
           count(*)::int AS count
         FROM knowledge_candidates
         WHERE status = 'published'
           AND updated_at >=
             date_trunc('hour', now()) - interval '23 hours'
         GROUP BY date_trunc('hour', updated_at)
       )
       SELECT
         hours.hour,
         coalesce(published.count, 0)::int AS published
       FROM hours
       LEFT JOIN published ON published.hour = hours.hour
       ORDER BY hours.hour`,
    ),
    database.query(
      `SELECT id, pipeline_task_id, source_candidate_id, stage,
              event_type, message, metadata, created_at
       FROM pipeline_events
       WHERE event_type = 'failed'
       ORDER BY created_at DESC, id DESC
       LIMIT 12`,
    ),
    database.query(
      `SELECT
         pt.id,
         pt.task_type,
         pt.stage,
         pt.status,
         pt.claim_owner,
         pt.lease_until,
         pt.heartbeat_at,
         pt.created_at,
         sc.id AS source_id,
         sc.title AS source_title,
         sc.status AS source_status,
         ct.vendor_slug,
         ct.operating_system_slug,
         ct.document_role
       FROM pipeline_tasks pt
       LEFT JOIN source_candidates sc ON sc.id = pt.source_candidate_id
       LEFT JOIN coverage_targets ct ON ct.id = pt.coverage_target_id
       WHERE pt.status IN ('queued', 'claimed', 'running')
       ORDER BY pt.priority DESC, pt.created_at
       LIMIT 1`,
    )
  ])

  const data = summary.rows[0] ?? {}
  const publishedRecords24h = publishedHourly.rows.reduce(
    (total, row) => total + Number(row.published ?? 0),
    0,
  )
  return {
    ...data,
    pause_pending:
      data['pipeline_enabled'] === false &&
      Number(data['active_luna_executors'] ?? 0) > 0,
    published_records_24h: publishedRecords24h,
    deployed_commit_sha: deployedCommitSha,
    processes: [
      {
        worker_name: 'api',
        instance_id: 'current-request',
        heartbeat_at: new Date().toISOString(),
        metadata: { status: 'running' },
        healthy: true
      },
      {
        worker_name: 'database',
        instance_id: 'postgresql',
        heartbeat_at: new Date().toISOString(),
        metadata: { status: 'query_succeeded' },
        healthy: true
      },
      ...health.rows
    ],
    active_work: activeTask.rows[0] ?? null,
    pipeline_funnel: funnel.rows,
    breakdowns: {
      vendor: breakdown.rows.filter((row) => row.dimension === 'vendor')
        .slice(0, 20),
      operating_system: breakdown.rows
        .filter((row) => row.dimension === 'operating_system')
        .slice(0, 20),
      risk: breakdown.rows.filter((row) => row.dimension === 'risk'),
      origin: breakdown.rows.filter((row) => row.dimension === 'origin')
    },
    activity_30d: activity.rows,
    published_hourly_24h: publishedHourly.rows,
    recent_errors: errors.rows
  }
}

export async function listCoverageTargets(database: Database) {
  const result = await database.query(
    `SELECT
       ct.*,
       coalesce(source_counts.total, 0)::int AS source_count,
       coalesce(source_counts.completed, 0)::int AS completed_sources,
       coalesce(source_counts.failed, 0)::int AS failed_sources
     FROM coverage_targets ct
     LEFT JOIN LATERAL (
       SELECT
         count(*) AS total,
         count(*) FILTER (WHERE status = 'completed') AS completed,
         count(*) FILTER (WHERE status = 'failed') AS failed
       FROM source_candidates sc
       WHERE sc.coverage_target_id = ct.id
     ) source_counts ON true
     ORDER BY ct.priority DESC, ct.next_check_at, ct.created_at`,
  )
  return result.rows
}

export async function listSources(
  database: Database,
  status: string | null,
  limit: number,
) {
  const result = await database.query(
    `SELECT
       sc.id,
       sc.title,
       sc.document_type,
       sc.document_version,
       sc.document_date,
       sc.status,
       sc.content_hash,
       sc.failure_code,
       sc.failure_message,
       sc.discovered_at,
       sc.updated_at,
       sc.completed_at,
       ct.vendor_slug,
       ct.product_family,
       ct.model,
       ct.operating_system_slug,
       ct.version_branch,
       ct.document_role,
       sa.media_type,
       sa.byte_size,
       sa.page_count,
       sa.status AS artifact_status,
       coalesce(fragment_counts.total, 0)::int AS fragments_total,
       coalesce(fragment_counts.completed, 0)::int AS fragments_completed
     FROM source_candidates sc
     JOIN coverage_targets ct ON ct.id = sc.coverage_target_id
     LEFT JOIN source_artifacts sa ON sa.source_candidate_id = sc.id
     LEFT JOIN LATERAL (
       SELECT
         count(*) AS total,
         count(*) FILTER (
           WHERE sf.status IN ('analyzed','verified','published','rejected')
         ) AS completed
       FROM source_fragments sf
       WHERE sf.source_artifact_id = sa.id
     ) fragment_counts ON true
     WHERE ($1::text IS NULL OR sc.status = $1)
     ORDER BY sc.updated_at DESC
     LIMIT $2`,
    [status, limit],
  )
  return result.rows
}

export async function getPipelineDetails(database: Database) {
  const [settings, tasks, events] = await Promise.all([
    database.query(`SELECT * FROM pipeline_settings WHERE singleton`),
    database.query(
      `SELECT
         pt.id, pt.task_type, pt.stage, pt.status, pt.priority,
         pt.coverage_target_id, pt.source_candidate_id, pt.expert_task_id,
         pt.claim_owner, pt.lease_until, pt.heartbeat_at, pt.attempts,
         pt.failure_code, pt.failure_message, pt.created_at, pt.updated_at,
         pt.completed_at, pt.result,
         sc.title AS source_title
       FROM pipeline_tasks pt
       LEFT JOIN source_candidates sc ON sc.id = pt.source_candidate_id
       ORDER BY pt.created_at DESC
       LIMIT 200`,
    ),
    database.query(
      `SELECT id, pipeline_task_id, source_candidate_id, stage,
              event_type, message, metadata, created_at
       FROM pipeline_events
       ORDER BY created_at DESC, id DESC
       LIMIT 300`,
    )
  ])
  return {
    settings: settings.rows[0],
    tasks: tasks.rows,
    events: events.rows
  }
}

export async function getActiveSource(database: Database) {
  const source = await database.query(
    `SELECT
       sc.id,
       sc.title,
       sc.document_type,
       sc.document_version,
       sc.document_date,
       sc.status,
       sc.failure_code,
       sc.failure_message,
       sc.discovered_at,
       sc.updated_at,
       sc.completed_at,
       ct.vendor_slug,
       ct.product_family,
       ct.model,
       ct.operating_system_slug,
       ct.version_branch,
       ct.document_role,
       sa.id AS artifact_id,
       sa.media_type,
       sa.byte_size,
       sa.page_count,
       sa.status AS artifact_status,
       sa.acquired_at,
       sa.converted_at,
       (SELECT count(*)::int FROM source_fragments sf
        WHERE sf.source_artifact_id = sa.id) AS fragments_total,
       (SELECT count(*)::int FROM source_fragments sf
        WHERE sf.source_artifact_id = sa.id
          AND sf.status IN ('analyzed','verified','published','rejected'))
          AS fragments_completed,
       (SELECT count(*)::int FROM knowledge_candidates kc
        JOIN pipeline_tasks pt ON pt.id = kc.pipeline_task_id
        WHERE pt.source_candidate_id = sc.id) AS candidates_total,
       (SELECT count(*)::int FROM knowledge_candidates kc
        JOIN pipeline_tasks pt ON pt.id = kc.pipeline_task_id
        WHERE pt.source_candidate_id = sc.id
          AND kc.status = 'verified') AS candidates_verified
     FROM pipeline_settings ps
     JOIN source_candidates sc ON sc.id = ps.active_source_id
     JOIN coverage_targets ct ON ct.id = sc.coverage_target_id
     LEFT JOIN source_artifacts sa ON sa.source_candidate_id = sc.id
     WHERE ps.singleton`,
  )
  if (!source.rows[0]) return null
  const [fragments, candidates, errors] = await Promise.all([
    database.query(
      `SELECT id, ordinal, section_title, source_locator, content_hash,
              status, attempts, created_at, updated_at
       FROM source_fragments
       WHERE source_artifact_id = $1
       ORDER BY ordinal
       LIMIT 500`,
      [source.rows[0].artifact_id],
    ),
    database.query(
      `SELECT kc.id, kc.stable_key, kc.status, kc.dangerous,
              kc.confidence, kc.quality_score, kc.revision_id,
              kc.created_at, kc.updated_at
       FROM knowledge_candidates kc
       JOIN pipeline_tasks pt ON pt.id = kc.pipeline_task_id
       WHERE pt.source_candidate_id = $1
       ORDER BY kc.created_at DESC
       LIMIT 500`,
      [source.rows[0].id],
    ),
    database.query(
      `SELECT id, pipeline_task_id, source_candidate_id, stage,
              event_type, message, metadata, created_at
       FROM pipeline_events
       WHERE source_candidate_id = $1
         AND event_type IN ('failed','retried','progress')
       ORDER BY created_at DESC, id DESC
       LIMIT 100`,
      [source.rows[0].id],
    )
  ])
  return {
    source: source.rows[0],
    fragments: fragments.rows,
    candidates: candidates.rows,
    events: errors.rows
  }
}

export async function listKnowledge(
  database: Database,
  input: {
    query: string | null
    vendor: string | null
    operatingSystem: string | null
    kind: string | null
    risk: string | null
    origin: string | null
    limit: number
    offset: number
  },
) {
  const whereClause = `
     WHERE ($1::text IS NULL OR (
       pak.search_document @@ websearch_to_tsquery('simple', $1)
       OR lower(pak.title) % lower($1)
     ))
       AND ($2::text IS NULL OR pak.vendor_slug = $2)
       AND ($3::text IS NULL OR pak.operating_system_slug = $3)
       AND ($4::text IS NULL OR pak.kind = $4)
       AND ($5::text IS NULL OR pak.risk_level = $5)
       AND ($6::text IS NULL OR pak.origin = $6)`
  const filterParameters = [
    input.query,
    input.vendor,
    input.operatingSystem,
    input.kind,
    input.risk,
    input.origin
  ]
  const [items, count] = await Promise.all([
    database.query(
      `SELECT
       pak.revision_id,
       pak.stable_key,
       pak.kind,
       pak.origin,
       pak.risk_level,
       pak.vendor_slug,
       pak.vendor_name,
       pak.platform_name,
       pak.operating_system_slug,
       pak.operating_system_name,
       pak.version_min,
       pak.version_max,
       pak.title,
       pak.summary,
       pak.dangerous,
       pak.confidence,
       pak.quality_score,
       pak.validation_level,
       pak.last_verified_at,
       pak.revision_created_at
     FROM public_active_knowledge pak
     ${whereClause}
     ORDER BY pak.revision_created_at DESC, pak.revision_id DESC
     LIMIT $7 OFFSET $8`,
      [...filterParameters, input.limit, input.offset],
    ),
    database.query<{ total: number }>(
      `SELECT count(*)::int AS total
       FROM public_active_knowledge pak
       ${whereClause}`,
      filterParameters,
    )
  ])
  return {
    items: items.rows,
    total: count.rows[0]?.total ?? 0,
    limit: input.limit,
    offset: input.offset
  }
}

export async function listImports(database: Database) {
  const result = await database.query(
    `SELECT
       ir.*,
       coalesce((
         SELECT count(*)::int FROM import_items ii
         WHERE ii.import_run_id = ir.id AND ii.status = 'accepted'
       ), 0) AS reconciled_items,
       coalesce((
         SELECT count(*)::int FROM import_items ii
         WHERE ii.import_run_id = ir.id AND ii.revision_id IS NOT NULL
       ), 0) AS mapped_revisions
     FROM import_runs ir
     ORDER BY ir.started_at DESC
     LIMIT 100`,
  )
  return result.rows
}

export async function listAgentRuns(database: Database, limit: number) {
  const result = await database.query(
    `SELECT
       ar.id,
       ar.pipeline_task_id,
       pt.task_type,
       pt.stage,
       ar.model,
       ar.reasoning_effort,
       ar.status,
       ar.input_tokens,
       ar.cached_input_tokens,
       ar.output_tokens,
       ar.reasoning_output_tokens,
       (
         ar.input_tokens + ar.output_tokens + ar.reasoning_output_tokens
       ) AS total_tokens,
       ar.published_revisions,
       CASE WHEN ar.published_revisions > 0 THEN round(
         (
           ar.input_tokens + ar.output_tokens + ar.reasoning_output_tokens
         )::numeric / ar.published_revisions,
         2
       ) ELSE NULL END AS tokens_per_revision,
       ar.duration_ms,
       ar.error_code,
       ar.started_at,
       ar.completed_at
     FROM agent_runs ar
     LEFT JOIN pipeline_tasks pt ON pt.id = ar.pipeline_task_id
     ORDER BY ar.started_at DESC
     LIMIT $1`,
    [limit],
  )
  return result.rows
}

export async function getQualityDashboard(database: Database) {
  const [summary, evals, latency, conflicts] = await Promise.all([
    database.query(
      `SELECT
         count(*)::int AS revisions,
         round(avg(confidence)::numeric, 4) AS avg_confidence,
         round(avg(quality_score)::numeric, 4) AS avg_quality,
         count(*) FILTER (WHERE dangerous)::int AS dangerous_revisions,
         count(*) FILTER (
           WHERE dangerous AND confidence < 0.95
         )::int AS dangerous_below_threshold,
         count(*) FILTER (
           WHERE NOT dangerous AND confidence < 0.90
         )::int AS regular_below_threshold
       FROM public_active_knowledge`,
    ),
    database.query(
      `SELECT * FROM product_eval_runs
       ORDER BY executed_at DESC
       LIMIT 50`,
    ),
    database.query(
      `SELECT operation,
              sum(request_count)::bigint AS requests,
              round(
                sum(total_duration_ms)::numeric /
                nullif(sum(request_count), 0),
                2
              ) AS average_ms
       FROM public_usage_daily
       WHERE day >= current_date - 29
       GROUP BY operation
       ORDER BY requests DESC`,
    ),
    database.query(
      `SELECT severity, status, count(*)::int AS count
       FROM knowledge_conflicts
       GROUP BY severity, status
       ORDER BY severity, status`,
    )
  ])
  return {
    summary: summary.rows[0],
    eval_runs: evals.rows,
    operation_latency_30d: latency.rows,
    conflicts: conflicts.rows
  }
}

export async function listLabValidations(database: Database) {
  const [runs, counts] = await Promise.all([
    database.query(
      `SELECT
         kv.id,
         kv.revision_id,
         ki.stable_key,
         kv.validation_type,
         kv.status,
         kv.fixture_key,
         kv.tool_version,
         kv.report_hash,
         kv.commit_sha,
         kv.summary,
         kv.executed_at,
         kv.expires_at
       FROM knowledge_validations kv
       JOIN knowledge_revisions kr ON kr.id = kv.revision_id
       JOIN knowledge_items ki ON ki.id = kr.knowledge_item_id
       ORDER BY kv.executed_at DESC
       LIMIT 200`,
    ),
    database.query(
      `SELECT validation_type, status, count(*)::int AS count
       FROM knowledge_validations
       GROUP BY validation_type, status
       ORDER BY validation_type, status`,
    )
  ])
  return { runs: runs.rows, counts: counts.rows }
}

export async function listFeedback(database: Database) {
  const result = await database.query(
    `SELECT id, revision_id, task_id, rating, category, comment, created_at
     FROM feedback
     ORDER BY created_at DESC
     LIMIT 200`,
  )
  return result.rows
}

export async function setPipelineEnabled(
  database: Database,
  enabled: boolean,
  actor: { id: string; role: AdminRole },
  reason: string | null,
) {
  const result = await withTransaction(database, async (client) => {
    const updated = await client.query(
      `UPDATE pipeline_settings
          SET enabled = $1,
              paused_reason = CASE WHEN $1 THEN NULL ELSE $2 END,
              pause_requested_at = CASE WHEN $1 THEN NULL ELSE now() END,
              control_generation = control_generation + 1,
              updated_at = now(),
              updated_by = $3
        WHERE singleton
        RETURNING *`,
      [enabled, reason, actor.id],
    )
    await client.query(
      `INSERT INTO pipeline_events (
         stage, event_type, message, metadata
       )
       VALUES (
         'system',
         $1,
         $2,
         jsonb_build_object('actor_id', $3::text)
       )`,
      [
        enabled ? 'resumed' : 'paused',
        enabled
          ? 'Continuous pipeline resumed by super admin.'
          : 'Continuous pipeline paused by super admin.',
        actor.id
      ],
    )
    await client.query(
      `INSERT INTO admin_audit_events (
         actor_id, actor_role, action, target_type, target_id, metadata
       )
       VALUES ($1, $2, $3, 'pipeline', NULL, $4::jsonb)`,
      [
        actor.id,
        actor.role,
        enabled ? 'pipeline.resume' : 'pipeline.pause',
        JSON.stringify({ reason })
      ],
    )
    return updated.rows[0]
  })
  if (enabled) await ensurePipelineWork(database)
  return result
}

export async function setPipelineConcurrency(
  database: Database,
  maxConcurrentAiRuns: number,
  actor: { id: string; role: AdminRole },
) {
  const result = await withTransaction(database, async (client) => {
    const updated = await client.query(
      `UPDATE pipeline_settings
          SET max_concurrent_ai_runs = $1,
              control_generation = control_generation + 1,
              updated_at = now(),
              updated_by = $2
        WHERE singleton
        RETURNING *`,
      [maxConcurrentAiRuns, actor.id],
    )
    await client.query(
      `INSERT INTO admin_audit_events (
         actor_id, actor_role, action, target_type, target_id, metadata
       )
       VALUES (
         $1,
         $2,
         'pipeline.concurrency',
         'pipeline',
         NULL,
         jsonb_build_object('max_concurrent_ai_runs', $3::int)
       )`,
      [actor.id, actor.role, maxConcurrentAiRuns],
    )
    return updated.rows[0]
  })
  await ensurePipelineWork(database)
  return result
}

export async function updateCoveragePriority(
  database: Database,
  targetId: string,
  priority: number,
  actor: { id: string; role: AdminRole },
) {
  const result = await database.query(
    `UPDATE coverage_targets
        SET priority = $2,
            updated_at = now()
      WHERE id = $1
      RETURNING *`,
    [targetId, priority],
  )
  if (!result.rows[0]) return null
  await recordAdminAudit(
    database,
    actor,
    'coverage.priority',
    'coverage_target',
    targetId,
    { priority },
  )
  return result.rows[0]
}

export async function actOnSource(
  database: Database,
  sourceId: string,
  action: 'retry' | 'skip' | 'reject',
  actor: { id: string; role: AdminRole },
  reason: string | null = null,
) {
  const result = await withTransaction(database, async (client) => {
    const source = await client.query<{ id: string; coverage_target_id: string }>(
      `SELECT id, coverage_target_id
       FROM source_candidates
       WHERE id = $1
       FOR UPDATE`,
      [sourceId],
    )
    if (!source.rows[0]) return null
    if (action === 'retry') {
      const artifact = await client.query<{ status: string }>(
        `SELECT status FROM source_artifacts
         WHERE source_candidate_id = $1`,
        [sourceId],
      )
      const nextStatus = artifact.rows[0]?.status === 'chunked'
        ? 'analyzing'
        : artifact.rows[0]?.status === 'converted'
          ? 'converted'
          : artifact.rows[0]?.status === 'downloaded'
            ? 'acquired'
            : 'approved'
      await client.query(
        `UPDATE source_candidates
            SET status = $2,
                failure_code = NULL,
                failure_message = NULL,
                updated_at = now()
          WHERE id = $1`,
        [sourceId, nextStatus],
      )
      if (artifact.rows[0]?.status === 'chunked') {
        await client.query(
          `UPDATE source_fragments fragment
              SET status = 'queued',
                  reservation_task_id = NULL,
                  attempts = 0,
                  updated_at = now()
             FROM source_artifacts artifact
            WHERE fragment.source_artifact_id = artifact.id
              AND artifact.source_candidate_id = $1
              AND fragment.status IN (
                'queued',
                'reserved',
                'analyzing',
                'failed'
              )`,
          [sourceId],
        )
        await client.query(
          `UPDATE knowledge_candidates candidate
              SET verification_task_id = NULL,
                  updated_at = now()
             FROM pipeline_tasks task
            WHERE candidate.pipeline_task_id = task.id
              AND task.source_candidate_id = $1
              AND candidate.status = 'analyzed'`,
          [sourceId],
        )
      }
      await client.query(
        `UPDATE pipeline_settings
            SET active_source_id = $1,
                updated_at = now(),
                updated_by = $2
          WHERE singleton`,
        [sourceId, actor.id],
      )
    } else {
      await client.query(
        `UPDATE source_candidates
            SET status = 'rejected',
                completed_at = now(),
                failure_code = $2,
                failure_message = $3,
                updated_at = now()
          WHERE id = $1`,
        [
          sourceId,
          action === 'skip' ? 'ADMIN_SKIPPED' : 'ADMIN_REJECTED',
          action === 'skip'
            ? 'Source skipped by super admin.'
            : 'Source rejected by super admin.'
        ],
      )
      await client.query(
        `UPDATE pipeline_settings
            SET active_source_id = NULL,
                updated_at = now(),
                updated_by = $2
          WHERE singleton AND active_source_id = $1`,
        [sourceId, actor.id],
      )
      await client.query(
        `UPDATE coverage_targets
            SET status = 'queued',
                next_check_at = now(),
                updated_at = now()
          WHERE id = $1`,
        [source.rows[0].coverage_target_id],
      )
    }
    await client.query(
      `UPDATE pipeline_tasks
          SET status = 'skipped',
              failure_code = 'ADMIN_REPLACED_STAGE',
              failure_message = 'Stage replaced by a super-admin source action.',
              completed_at = now(),
              updated_at = now()
        WHERE source_candidate_id = $1
          AND status IN ('queued','claimed','running')`,
      [sourceId],
    )
    await client.query(
      `INSERT INTO admin_audit_events (
         actor_id, actor_role, action, target_type, target_id, metadata
       )
       VALUES (
         $1, $2, $3, 'source_candidate', $4,
         jsonb_build_object('reason', $5::text)
       )`,
      [actor.id, actor.role, `source.${action}`, sourceId, reason],
    )
    return { id: sourceId, action }
  })
  if (result) await ensurePipelineWork(database)
  return result
}

export async function forceDiscovery(
  database: Database,
  actor: { id: string; role: AdminRole },
  targetId: string | null,
) {
  const result = await database.query<{ id: string }>(
    `UPDATE coverage_targets
        SET status = 'queued',
            next_check_at = now(),
            priority = least(100, priority + 10),
            updated_at = now()
      WHERE id = coalesce(
        $1::uuid,
        (
          SELECT id FROM coverage_targets
          WHERE status <> 'paused'
          ORDER BY priority DESC, next_check_at
          LIMIT 1
        )
      )
      RETURNING id`,
    [targetId],
  )
  if (!result.rows[0]) return null
  await recordAdminAudit(
    database,
    actor,
    'pipeline.force_discovery',
    'coverage_target',
    result.rows[0].id,
  )
  await ensurePipelineWork(database)
  return { coverage_target_id: result.rows[0].id, queued: true }
}

export async function actOnExpertTask(
  database: Database,
  publicId: string,
  action: 'requeue' | 'cancel',
  actor: { id: string; role: AdminRole },
  reason: string | null = null,
) {
  const result = await withTransaction(database, async (client) => {
    const updated = await client.query(
      `UPDATE expert_tasks
          SET status = $2,
              claim_owner = NULL,
              lease_token_hash = NULL,
              lease_until = NULL,
              heartbeat_at = NULL,
              failure_code = NULL,
              failure_message = NULL,
              completed_at = CASE WHEN $2 = 'cancelled' THEN now() ELSE NULL END,
              updated_at = now()
        WHERE public_id = $1
        RETURNING public_id, status, priority, attempts, updated_at`,
      [publicId, action === 'requeue' ? 'queued' : 'cancelled'],
    )
    if (!updated.rows[0]) return null
    await client.query(
      `UPDATE pipeline_tasks
          SET status = 'cancelled',
              completed_at = now(),
              updated_at = now()
        WHERE expert_task_id = (
          SELECT id FROM expert_tasks WHERE public_id = $1
        )
          AND status IN ('queued','claimed','running')`,
      [publicId],
    )
    await client.query(
      `INSERT INTO admin_audit_events (
         actor_id, actor_role, action, target_type, target_id, metadata
       )
       VALUES (
         $1, $2, $3, 'expert_task', $4,
         jsonb_build_object('reason', $5::text)
       )`,
      [actor.id, actor.role, `expert_task.${action}`, publicId, reason],
    )
    return updated.rows[0]
  })
  if (result && action === 'requeue') await ensurePipelineWork(database)
  return result
}

export async function decideConflict(
  database: Database,
  conflictId: string,
  decision: 'resolved' | 'accepted',
  reason: string,
  actor: { id: string; role: AdminRole },
) {
  const result = await database.query(
    `UPDATE knowledge_conflicts
        SET status = $2,
            description = concat(description, E'\nAdmin decision: ', $3),
            resolved_at = now()
      WHERE id = $1 AND status = 'open'
      RETURNING *`,
    [conflictId, decision, reason],
  )
  if (!result.rows[0]) return null
  await recordAdminAudit(
    database,
    actor,
    'conflict.decision',
    'knowledge_conflict',
    conflictId,
    { decision },
  )
  return result.rows[0]
}
