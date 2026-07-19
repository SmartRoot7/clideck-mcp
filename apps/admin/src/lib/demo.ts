import type {
  CoverageTarget,
  Overview,
  PipelineDetails,
  Quality
} from '@clideck/admin-contracts'
import {
  publicDemoSnapshotSchema,
  type PublicDemoSnapshot
} from '@clideck/demo-contracts'

export async function fetchPublicDemoSnapshot(): Promise<PublicDemoSnapshot> {
  const response = await fetch('/public/v1/demo/snapshot', {
    cache: 'no-store',
    credentials: 'omit',
    headers: { accept: 'application/json' }
  })
  if (!response.ok) throw new Error(`PUBLIC_DEMO_UNAVAILABLE:${response.status}`)
  return publicDemoSnapshotSchema.parse(await response.json())
}

export function demoOverview(snapshot: PublicDemoSnapshot): Overview {
  const activeTask = snapshot.pipeline_tasks.find((task) =>
    task.status === 'running' || task.status === 'claimed')
  return {
    active_release: `release-${snapshot.release.sequence}`,
    active_release_sequence: snapshot.release.sequence,
    active_release_created_at: snapshot.release.published_at,
    published_revisions: snapshot.release.published_knowledge,
    pipeline_enabled: snapshot.system.pipeline_enabled,
    ai_model: snapshot.operations.ai_model,
    reasoning_effort: snapshot.operations.reasoning_effort,
    max_concurrent_ai_runs: snapshot.system.configured_luna,
    control_generation: 0,
    pause_requested_at: null,
    paused_reason: snapshot.system.status === 'paused'
      ? 'Pipeline paused'
      : null,
    pipeline_updated_at: snapshot.operations.pipeline_updated_at,
    active_source_id: null,
    active_source_title: null,
    active_source_status: null,
    active_vendor: null,
    active_operating_system: null,
    active_document_role: null,
    queued_tasks: snapshot.operations.queued_tasks,
    open_conflicts: snapshot.operations.open_conflicts,
    feedback_24h: snapshot.operations.feedback_24h,
    sources_total: snapshot.operations.sources_total,
    sources_completed: snapshot.operations.sources_completed,
    fragments_total: snapshot.operations.fragments_total,
    candidates_total: snapshot.operations.candidates_total,
    failures_24h: snapshot.operations.failures_24h,
    completed_stages_24h: snapshot.operations.completed_stages_24h,
    tokens_total: snapshot.operations.tokens_total,
    tokens_today: snapshot.operations.tokens_today,
    active_agent_runs: snapshot.system.active_luna,
    active_luna_executors: snapshot.system.active_luna,
    queued_expert: snapshot.operations.queued_expert,
    queued_verify: snapshot.operations.queued_verify,
    queued_analyze: snapshot.operations.queued_analyze,
    queued_discover: snapshot.operations.queued_discover,
    tokens_per_revision: snapshot.operations.tokens_per_revision,
    pause_pending: false,
    published_records_24h: snapshot.release.published_24h,
    deployed_commit_sha: null,
    processes: snapshot.operations.executors.map((executor) => ({
      worker_name: executor.id,
      instance_id: executor.id,
      heartbeat_at: executor.heartbeat_at,
      metadata: {
        state: executor.state,
        stage: executor.stage
      },
      healthy: executor.healthy
    })),
    active_work: activeTask
      ? {
          id: 'public-active-task',
          task_type: activeTask.task_type,
          stage: activeTask.stage,
          status: activeTask.status,
          claim_owner: null,
          lease_until: activeTask.lease_until,
          heartbeat_at: activeTask.heartbeat_at,
          created_at: activeTask.created_at,
          source_id: null,
          source_title: null,
          source_status: null,
          vendor_slug: null,
          operating_system_slug: null,
          document_role: null
        }
      : null,
    pipeline_funnel: snapshot.pipeline_funnel.map((stage) => ({
      ...stage,
      count: stage.queued + stage.running + stage.completed + stage.failed,
      cancelled: 0,
      skipped: 0
    })),
    breakdowns: {
      vendor: snapshot.operations.breakdowns.vendor,
      operating_system: snapshot.operations.breakdowns.operating_system,
      risk: snapshot.operations.breakdowns.risk,
      origin: snapshot.operations.breakdowns.origin
    },
    activity_30d: snapshot.operations.activity_30d,
    published_hourly_24h: snapshot.published_hourly_24h,
    recent_errors: []
  }
}

export function demoPipeline(snapshot: PublicDemoSnapshot): PipelineDetails {
  return {
    settings: {
      singleton: true,
      enabled: snapshot.system.pipeline_enabled,
      ai_model: snapshot.operations.ai_model,
      reasoning_effort: snapshot.operations.reasoning_effort,
      max_concurrent_ai_runs: snapshot.system.configured_luna,
      active_source_id: null,
      active_coverage_target_id: null,
      control_generation: 0,
      pause_requested_at: null,
      paused_reason: snapshot.system.status === 'paused'
        ? 'Pipeline paused'
        : null,
      updated_at: snapshot.operations.pipeline_updated_at,
      updated_by: null
    },
    tasks: snapshot.pipeline_tasks.map((task, index) => ({
      id: `public-task-${index + 1}`,
      task_type: task.task_type,
      stage: task.stage,
      status: task.status,
      priority: task.priority,
      coverage_target_id: null,
      source_candidate_id: null,
      expert_task_id: null,
      claim_owner: null,
      lease_until: task.lease_until,
      heartbeat_at: task.heartbeat_at,
      attempts: task.attempts,
      failure_code: null,
      failure_message: null,
      created_at: task.created_at,
      updated_at: task.updated_at,
      completed_at: task.completed_at,
      result: null,
      source_title: null
    })),
    events: []
  }
}

export function demoCoverage(
  snapshot: PublicDemoSnapshot,
): CoverageTarget[] {
  return snapshot.coverage.targets.map((target, index) => ({
    id: `public-coverage-${index + 1}`,
    ...target
  }))
}

export function demoQuality(snapshot: PublicDemoSnapshot): Quality {
  return {
    summary: snapshot.quality.summary,
    eval_runs: snapshot.quality.eval_runs.map((run, index) => ({
      id: index + 1,
      ...run,
      commit_sha: null,
      report_hash: 'public-result'
    })),
    operation_latency_30d: snapshot.quality.operation_latency_30d,
    conflicts: snapshot.quality.conflicts
  }
}
