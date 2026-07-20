import type {
  ActiveSourceDetail,
  ActiveSourceLane,
  ExpertTask,
  Feedback,
  ImportRun,
  McpRequestLogDetail,
  McpRequestLogPage,
  Overview,
  PipelineDetails,
  Provenance,
  ReviewException,
  ReviewExceptionDetail,
  Release,
  Source
} from '@clideck/admin-contracts'

export const REDACTED_SOURCE_IDENTITY = 'XXXXXXXX'

const SAFE_OPERATIONAL_METADATA_KEYS = new Set([
  'attempt',
  'completed',
  'count',
  'enabled',
  'failed',
  'max_concurrent_ai_runs',
  'progress_percent',
  'queued',
  'running',
  'skipped',
  'stage',
  'state',
  'status',
  'task_type'
])

function redactNullable(value: string | null): string | null {
  return value === null ? null : REDACTED_SOURCE_IDENTITY
}

function redactRequestValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactRequestValue)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(
        ([key, entry]) => [key, redactRequestValue(entry)],
      ),
    )
  }
  return value === null ? null : REDACTED_SOURCE_IDENTITY
}

export function sanitizeDemoMcpRequestPage(
  page: McpRequestLogPage,
): McpRequestLogPage {
  return {
    ...page,
    items: page.items.map((row) => ({
      ...row,
      request_id: REDACTED_SOURCE_IDENTITY,
      client_ip: REDACTED_SOURCE_IDENTITY,
      question_preview: REDACTED_SOURCE_IDENTITY,
      knowledge_demand_id:
        row.knowledge_demand_id === null
          ? null
          : REDACTED_SOURCE_IDENTITY
    }))
  }
}

export function sanitizeDemoMcpRequestDetail(
  detail: McpRequestLogDetail,
): McpRequestLogDetail {
  return {
    ...detail,
    request_id: REDACTED_SOURCE_IDENTITY,
    client_ip: REDACTED_SOURCE_IDENTITY,
    question_preview: REDACTED_SOURCE_IDENTITY,
    knowledge_demand_id:
      detail.knowledge_demand_id === null
        ? null
        : REDACTED_SOURCE_IDENTITY,
    request_payload: redactRequestValue(
      detail.request_payload,
    ) as McpRequestLogDetail['request_payload']
  }
}

function projectOperationalMetadata(
  metadata: Record<string, unknown>,
): Record<string, unknown> {
  const projected: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(metadata)) {
    if (!SAFE_OPERATIONAL_METADATA_KEYS.has(key)) continue
    if (
      value === null ||
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      projected[key] = value
    }
  }
  return projected
}

function sanitizePipelineEvent(
  event: PipelineDetails['events'][number],
): PipelineDetails['events'][number] {
  return {
    id: event.id,
    pipeline_task_id: event.pipeline_task_id,
    source_candidate_id: event.source_candidate_id,
    stage: event.stage,
    event_type: event.event_type,
    message: REDACTED_SOURCE_IDENTITY,
    metadata: projectOperationalMetadata(event.metadata),
    created_at: event.created_at
  }
}

export function sanitizeDemoOverview(overview: Overview): Overview {
  return {
    snapshot_at: overview.snapshot_at,
    active_release: overview.active_release,
    active_release_sequence: overview.active_release_sequence,
    active_release_created_at: overview.active_release_created_at,
    published_revisions: overview.published_revisions,
    pipeline_enabled: overview.pipeline_enabled,
    ai_model: overview.ai_model,
    reasoning_effort: overview.reasoning_effort,
    max_concurrent_ai_runs: overview.max_concurrent_ai_runs,
    max_active_sources: overview.max_active_sources,
    max_deep_review_runs: overview.max_deep_review_runs,
    prepared_source_target: overview.prepared_source_target,
    prepared_sources: overview.prepared_sources,
    control_generation: overview.control_generation,
    pause_requested_at: overview.pause_requested_at,
    paused_reason: redactNullable(overview.paused_reason),
    pipeline_updated_at: overview.pipeline_updated_at,
    active_source_id: overview.active_source_id,
    active_source_count: overview.active_source_count,
    active_source_title: redactNullable(overview.active_source_title),
    active_source_status: overview.active_source_status,
    active_vendor: overview.active_vendor,
    active_operating_system: overview.active_operating_system,
    active_document_role: overview.active_document_role,
    queued_tasks: overview.queued_tasks,
    open_conflicts: overview.open_conflicts,
    feedback_24h: overview.feedback_24h,
    sources_total: overview.sources_total,
    sources_completed: overview.sources_completed,
    fragments_total: overview.fragments_total,
    candidates_total: overview.candidates_total,
    failures_24h: overview.failures_24h,
    completed_stages_24h: overview.completed_stages_24h,
    tokens_total: overview.tokens_total,
    tokens_today: overview.tokens_today,
    active_agent_runs: overview.active_agent_runs,
    active_luna_executors: overview.active_luna_executors,
    queued_expert: overview.queued_expert,
    queued_verify: overview.queued_verify,
    queued_deep_review: overview.queued_deep_review,
    queued_analyze: overview.queued_analyze,
    queued_discover: overview.queued_discover,
    tokens_per_revision: overview.tokens_per_revision,
    projected_publications_per_day:
      overview.projected_publications_per_day,
    automatic_resolution_rate: overview.automatic_resolution_rate,
    manual_exceptions_24h: overview.manual_exceptions_24h,
    technical_retries_24h: overview.technical_retries_24h,
    automatic_rejections_24h: overview.automatic_rejections_24h,
    average_analysis_batch: overview.average_analysis_batch,
    average_verification_batch: overview.average_verification_batch,
    executor_utilization: overview.executor_utilization,
    discovery_unique_yield: overview.discovery_unique_yield,
    discovery_duplicates_avoided:
      overview.discovery_duplicates_avoided,
    publication_failures_24h: overview.publication_failures_24h,
    candidates_created_24h: overview.candidates_created_24h,
    candidates_verified_24h: overview.candidates_verified_24h,
    candidates_deep_resolved_24h:
      overview.candidates_deep_resolved_24h,
    record_outcomes_24h: overview.record_outcomes_24h,
    pause_pending: overview.pause_pending,
    published_records_24h: overview.published_records_24h,
    deployed_commit_sha: overview.deployed_commit_sha,
    processes: overview.processes.map((process) => ({
      worker_name: process.worker_name,
      instance_id: REDACTED_SOURCE_IDENTITY,
      heartbeat_at: process.heartbeat_at,
      metadata: projectOperationalMetadata(process.metadata),
      healthy: process.healthy
    })),
    executors: overview.executors.map((executor) => ({
      executor_id: executor.executor_id,
      instance_id: redactNullable(executor.instance_id),
      state: executor.state,
      healthy: executor.healthy,
      stage: executor.stage,
      task_id: executor.task_id,
      task_type: executor.task_type,
      work_units: executor.work_units,
      work_unit: executor.work_unit,
      heartbeat_at: executor.heartbeat_at,
      lease_until: executor.lease_until
    })),
    active_work: overview.active_work
      ? {
          id: overview.active_work.id,
          task_type: overview.active_work.task_type,
          stage: overview.active_work.stage,
          status: overview.active_work.status,
          claim_owner: overview.active_work.claim_owner,
          lease_until: overview.active_work.lease_until,
          heartbeat_at: overview.active_work.heartbeat_at,
          created_at: overview.active_work.created_at,
          source_id: overview.active_work.source_id,
          source_title: redactNullable(overview.active_work.source_title),
          source_status: overview.active_work.source_status,
          vendor_slug: overview.active_work.vendor_slug,
          operating_system_slug:
            overview.active_work.operating_system_slug,
          document_role: overview.active_work.document_role
        }
      : null,
    pipeline_funnel: overview.pipeline_funnel.map((stage) => ({
      stage: stage.stage,
      count: stage.count,
      queued: stage.queued,
      running: stage.running,
      completed: stage.completed,
      failed: stage.failed,
      cancelled: stage.cancelled,
      skipped: stage.skipped,
      waiting: stage.waiting,
      waiting_unit: stage.waiting_unit,
      oldest_waiting_at: stage.oldest_waiting_at,
      active_executor_ids: stage.active_executor_ids,
      active_worker_count: stage.active_worker_count
    })),
    source_intake: overview.source_intake.map((stage) => ({
      stage: stage.stage,
      unit: stage.unit,
      waiting: stage.waiting,
      in_flight: stage.in_flight,
      processed_24h: stage.processed_24h,
      output_24h: stage.output_24h,
      failed_24h: stage.failed_24h,
      oldest_waiting_at: stage.oldest_waiting_at,
      active_executor_ids: stage.active_executor_ids,
      active_worker_count: stage.active_worker_count
    })),
    record_pipeline: overview.record_pipeline.map((stage) => ({
      stage: stage.stage,
      unit: stage.unit,
      waiting: stage.waiting,
      in_flight: stage.in_flight,
      processed_24h: stage.processed_24h,
      passed_24h: stage.passed_24h,
      escalated_24h: stage.escalated_24h,
      rejected_24h: stage.rejected_24h,
      oldest_waiting_at: stage.oldest_waiting_at,
      active_executor_ids: stage.active_executor_ids
    })),
    breakdowns: {
      vendor: overview.breakdowns.vendor.map((row) => ({
        dimension: row.dimension,
        key: row.key,
        count: row.count
      })),
      operating_system: overview.breakdowns.operating_system.map((row) => ({
        dimension: row.dimension,
        key: row.key,
        count: row.count
      })),
      risk: overview.breakdowns.risk.map((row) => ({
        dimension: row.dimension,
        key: row.key,
        count: row.count
      })),
      origin: overview.breakdowns.origin.map((row) => ({
        dimension: row.dimension,
        key: row.key,
        count: row.count
      }))
    },
    activity_30d: overview.activity_30d.map((day) => ({
      day: day.day,
      published: day.published,
      revisions_created: day.revisions_created,
      stages_completed: day.stages_completed,
      tokens: day.tokens
    })),
    published_hourly_24h: overview.published_hourly_24h.map((hour) => ({
      hour: hour.hour,
      published: hour.published
    })),
    mcp_requests: overview.mcp_requests,
    recent_errors: overview.recent_errors.map((error) => ({
      id: error.id,
      pipeline_task_id: error.pipeline_task_id,
      source_candidate_id: error.source_candidate_id,
      stage: error.stage,
      event_type: error.event_type,
      message: REDACTED_SOURCE_IDENTITY,
      metadata: projectOperationalMetadata(error.metadata),
      created_at: error.created_at
    }))
  }
}

export function sanitizeDemoSources(sources: Source[]): Source[] {
  return sources.map((source) => ({
    id: source.id,
    title: REDACTED_SOURCE_IDENTITY,
    document_type: source.document_type,
    document_version: source.document_version,
    document_date: source.document_date,
    status: source.status,
    content_hash: redactNullable(source.content_hash),
    failure_code: source.failure_code,
    failure_message: redactNullable(source.failure_message),
    discovered_at: source.discovered_at,
    updated_at: source.updated_at,
    completed_at: source.completed_at,
    vendor_slug: source.vendor_slug,
    product_family: source.product_family,
    model: source.model,
    operating_system_slug: source.operating_system_slug,
    version_branch: source.version_branch,
    document_role: source.document_role,
    media_type: source.media_type,
    byte_size: source.byte_size,
    page_count: source.page_count,
    artifact_status: source.artifact_status,
    fragments_total: source.fragments_total,
    fragments_completed: source.fragments_completed
  }))
}

export function sanitizeDemoPipeline(
  pipeline: PipelineDetails,
): PipelineDetails {
  return {
    settings: {
      singleton: pipeline.settings.singleton,
      enabled: pipeline.settings.enabled,
      ai_model: pipeline.settings.ai_model,
      reasoning_effort: pipeline.settings.reasoning_effort,
      max_concurrent_ai_runs: pipeline.settings.max_concurrent_ai_runs,
      max_active_sources: pipeline.settings.max_active_sources,
      max_deep_review_runs: pipeline.settings.max_deep_review_runs,
      source_buffer_target: pipeline.settings.source_buffer_target,
      prepared_source_target:
        pipeline.settings.prepared_source_target,
      manual_exception_daily_cap:
        pipeline.settings.manual_exception_daily_cap,
      active_source_id: pipeline.settings.active_source_id,
      active_coverage_target_id:
        pipeline.settings.active_coverage_target_id,
      control_generation: pipeline.settings.control_generation,
      pause_requested_at: pipeline.settings.pause_requested_at,
      paused_reason: redactNullable(pipeline.settings.paused_reason),
      updated_at: pipeline.settings.updated_at,
      updated_by: redactNullable(pipeline.settings.updated_by)
    },
    tasks: pipeline.tasks.map((task) => ({
      id: task.id,
      task_type: task.task_type,
      stage: task.stage,
      status: task.status,
      priority: task.priority,
      coverage_target_id: task.coverage_target_id,
      source_candidate_id: task.source_candidate_id,
      expert_task_id: task.expert_task_id,
      claim_owner: task.claim_owner,
      lease_until: task.lease_until,
      heartbeat_at: task.heartbeat_at,
      attempts: task.attempts,
      failure_code: task.failure_code,
      failure_message: redactNullable(task.failure_message),
      created_at: task.created_at,
      updated_at: task.updated_at,
      completed_at: task.completed_at,
      result: null,
      source_title: redactNullable(task.source_title)
    })),
    events: pipeline.events.map(sanitizePipelineEvent)
  }
}

export function sanitizeDemoActiveSources(
  lanes: ActiveSourceLane[],
): ActiveSourceLane[] {
  return lanes.map((lane) => ({
    ...lane,
    title: REDACTED_SOURCE_IDENTITY
  }))
}

export function sanitizeDemoReviewExceptions(
  exceptions: ReviewException[],
): ReviewException[] {
  return exceptions.map((exception) => ({
    ...exception,
    source_title: redactNullable(exception.source_title),
    resolution_reason: redactNullable(exception.resolution_reason)
  }))
}

function sanitizeCandidatePayload(value: unknown, key = ''): unknown {
  if (
    [
      'url',
      'title',
      'document_title',
      'manual_title',
      'evidence_fragment',
      'source_locator',
      'content_hash'
    ].includes(key)
  ) {
    return value === null ? null : REDACTED_SOURCE_IDENTITY
  }
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeCandidatePayload(entry))
  }
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(
      ([entryKey, entryValue]) => [
        entryKey,
        sanitizeCandidatePayload(entryValue, entryKey)
      ],
    ),
  )
}

export function sanitizeDemoReviewException(
  detail: ReviewExceptionDetail,
): ReviewExceptionDetail {
  return {
    candidate: sanitizeDemoReviewExceptions([detail.candidate])[0]!,
    payload: sanitizeCandidatePayload(
      detail.payload,
    ) as Record<string, unknown>,
    verifications: detail.verifications.map((verification) => ({
      ...verification,
      findings: verification.findings.map(
        () => REDACTED_SOURCE_IDENTITY,
      ),
      verified_by: REDACTED_SOURCE_IDENTITY
    }))
  }
}

export function sanitizeDemoActiveSource(
  detail: ActiveSourceDetail,
): ActiveSourceDetail {
  if (!detail) return null
  return {
    source: {
      id: detail.source.id,
      title: REDACTED_SOURCE_IDENTITY,
      document_type: detail.source.document_type,
      document_version: detail.source.document_version,
      document_date: detail.source.document_date,
      status: detail.source.status,
      failure_code: detail.source.failure_code,
      failure_message: redactNullable(detail.source.failure_message),
      discovered_at: detail.source.discovered_at,
      updated_at: detail.source.updated_at,
      completed_at: detail.source.completed_at,
      vendor_slug: detail.source.vendor_slug,
      product_family: detail.source.product_family,
      model: detail.source.model,
      operating_system_slug: detail.source.operating_system_slug,
      version_branch: detail.source.version_branch,
      document_role: detail.source.document_role,
      artifact_id: detail.source.artifact_id,
      media_type: detail.source.media_type,
      byte_size: detail.source.byte_size,
      page_count: detail.source.page_count,
      artifact_status: detail.source.artifact_status,
      acquired_at: detail.source.acquired_at,
      converted_at: detail.source.converted_at,
      fragments_total: detail.source.fragments_total,
      fragments_completed: detail.source.fragments_completed,
      candidates_total: detail.source.candidates_total,
      candidates_verified: detail.source.candidates_verified
    },
    fragments: detail.fragments.map((fragment) => ({
      id: fragment.id,
      ordinal: fragment.ordinal,
      section_title: redactNullable(fragment.section_title),
      source_locator: redactNullable(fragment.source_locator),
      content_hash: REDACTED_SOURCE_IDENTITY,
      status: fragment.status,
      attempts: fragment.attempts,
      created_at: fragment.created_at,
      updated_at: fragment.updated_at
    })),
    candidates: detail.candidates.map((candidate) => ({
      id: candidate.id,
      stable_key: candidate.stable_key,
      status: candidate.status,
      dangerous: candidate.dangerous,
      confidence: candidate.confidence,
      quality_score: candidate.quality_score,
      revision_id: candidate.revision_id,
      created_at: candidate.created_at,
      updated_at: candidate.updated_at
    })),
    events: detail.events.map(sanitizePipelineEvent)
  }
}

export function sanitizeDemoImports(imports: ImportRun[]): ImportRun[] {
  return imports.map((run) => ({
    id: run.id,
    source_label: REDACTED_SOURCE_IDENTITY,
    manifest_hash: redactNullable(run.manifest_hash),
    records_seen: run.records_seen,
    records_quarantined: run.records_quarantined,
    records_imported: run.records_imported,
    records_published: run.records_published,
    records_failed: run.records_failed,
    last_legacy_key: redactNullable(run.last_legacy_key),
    status: run.status,
    started_at: run.started_at,
    completed_at: run.completed_at,
    error_message: redactNullable(run.error_message),
    reconciled_items: run.reconciled_items,
    mapped_revisions: run.mapped_revisions
  }))
}

export function sanitizeDemoExpertTasks(
  tasks: ExpertTask[],
): ExpertTask[] {
  return tasks.map((task, index) => ({
    public_id: `DEMO-TASK-${String(index + 1).padStart(3, '0')}`,
    tenant_id: null,
    status: task.status,
    priority: task.priority,
    attempts: task.attempts,
    claim_owner: null,
    lease_until: task.lease_until,
    expires_at: task.expires_at,
    created_at: task.created_at,
    updated_at: task.updated_at,
    completed_at: task.completed_at,
    failure_code: null,
    failure_message: redactNullable(task.failure_message),
    result_revision_id: null,
    stage: task.stage,
    progress_percent: task.progress_percent,
    public_message: redactNullable(task.public_message),
    result_release_sequence: null
  }))
}

export function sanitizeDemoReleases(releases: Release[]): Release[] {
  return releases.map((release) => ({
    id: release.id,
    sequence: release.sequence,
    status: release.status,
    reason: REDACTED_SOURCE_IDENTITY,
    created_by: release.created_by,
    created_at: release.created_at,
    active: release.active,
    revision_count: release.revision_count,
    release_mode: release.release_mode,
    changed_records: release.changed_records,
    parent_release_id: release.parent_release_id
  }))
}

export function sanitizeDemoFeedback(feedback: Feedback[]): Feedback[] {
  return feedback.map((row) => ({
    id: row.id,
    revision_id: null,
    task_id: null,
    rating: row.rating,
    category: row.category,
    comment: redactNullable(row.comment),
    created_at: row.created_at
  }))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function nullableNumberOrString(value: unknown): string | number | null {
  return typeof value === 'string' || typeof value === 'number'
    ? value
    : null
}

function projectNormalProvenance(value: unknown): Record<string, unknown> {
  const row = isRecord(value) ? value : {}
  return {
    vendor: nullableString(row['vendor']),
    title: REDACTED_SOURCE_IDENTITY,
    document_version: nullableString(row['document_version']),
    canonical_url: REDACTED_SOURCE_IDENTITY,
    document_date: nullableString(row['document_date']),
    verified_at: nullableString(row['verified_at']),
    content_hash: REDACTED_SOURCE_IDENTITY,
    evidence_fragment: REDACTED_SOURCE_IDENTITY,
    evidence_role: nullableString(row['evidence_role']),
    confidence_reason: REDACTED_SOURCE_IDENTITY
  }
}

function projectLegacyProvenance(
  value: Record<string, unknown>,
): Record<string, unknown> {
  return {
    origin: 'legacy_import',
    legacy_key: REDACTED_SOURCE_IDENTITY,
    item_type: nullableString(value['item_type']),
    source_trust: nullableString(value['source_trust']),
    lifecycle_status: nullableString(value['lifecycle_status']),
    original_risk_level: nullableString(value['original_risk_level']),
    original_confidence: nullableNumberOrString(
      value['original_confidence'],
    ),
    original_quality_score: nullableNumberOrString(
      value['original_quality_score'],
    ),
    published_at: nullableString(value['published_at']),
    provenance: REDACTED_SOURCE_IDENTITY,
    payload_hash: REDACTED_SOURCE_IDENTITY
  }
}

export function sanitizeDemoProvenance(
  provenance: Provenance,
): Provenance {
  const raw = provenance.provenance
  const projected = isRecord(raw) && raw['origin'] === 'legacy_import'
    ? projectLegacyProvenance(raw)
    : Array.isArray(raw)
      ? raw.map(projectNormalProvenance)
      : []
  return {
    revision_id: provenance.revision_id,
    provenance: projected,
    created_at: provenance.created_at,
    status: provenance.status
  }
}
