import { z } from 'zod'

export const scalarNumberSchema = z.union([z.number(), z.string()])
export const nullableScalarNumberSchema = scalarNumberSchema.nullable()
export const nullableStringSchema = z.string().nullable()
export const timestampSchema = z.string()

export const sessionActorSchema = z.object({
  id: z.string(),
  username: z.string(),
  role: z.literal('super_admin')
})

export const sessionSchema = z.object({
  authenticated: z.boolean(),
  actor: sessionActorSchema.nullable(),
  expires_at: z.string().nullable()
})

export const loginInputSchema = z.object({
  username: z.string().trim().min(1).max(128),
  password: z.string().min(1).max(1_024)
}).strict()

export const processSchema = z.object({
  worker_name: z.string(),
  instance_id: z.string(),
  heartbeat_at: timestampSchema,
  metadata: z.record(z.string(), z.unknown()),
  healthy: z.boolean()
})

export const funnelStageSchema = z.object({
  stage: z.string(),
  count: scalarNumberSchema,
  queued: scalarNumberSchema,
  running: scalarNumberSchema,
  completed: scalarNumberSchema,
  failed: scalarNumberSchema,
  cancelled: scalarNumberSchema,
  skipped: scalarNumberSchema
})

export const breakdownRowSchema = z.object({
  dimension: z.string().optional(),
  key: z.string(),
  count: scalarNumberSchema
})

export const activityDaySchema = z.object({
  day: timestampSchema,
  published: scalarNumberSchema,
  revisions_created: scalarNumberSchema,
  stages_completed: scalarNumberSchema,
  tokens: scalarNumberSchema
})

export const hourlyPublishedSchema = z.object({
  hour: timestampSchema,
  published: scalarNumberSchema
})

export const pipelineErrorSchema = z.object({
  id: z.string(),
  pipeline_task_id: nullableStringSchema,
  source_candidate_id: nullableStringSchema,
  stage: z.string(),
  event_type: z.string(),
  message: z.string(),
  metadata: z.record(z.string(), z.unknown()),
  created_at: timestampSchema
})

export const activeWorkSchema = z.object({
  id: z.string(),
  task_type: z.string(),
  stage: z.string(),
  status: z.string(),
  claim_owner: nullableStringSchema,
  lease_until: nullableStringSchema,
  heartbeat_at: nullableStringSchema,
  created_at: timestampSchema,
  source_id: nullableStringSchema,
  source_title: nullableStringSchema,
  source_status: nullableStringSchema,
  vendor_slug: nullableStringSchema,
  operating_system_slug: nullableStringSchema,
  document_role: nullableStringSchema
})

export const overviewSchema = z.object({
  active_release: z.string(),
  active_release_sequence: scalarNumberSchema,
  active_release_created_at: timestampSchema,
  published_revisions: scalarNumberSchema,
  pipeline_enabled: z.boolean(),
  ai_model: z.string(),
  reasoning_effort: z.string(),
  max_concurrent_ai_runs: scalarNumberSchema,
  control_generation: scalarNumberSchema,
  pause_requested_at: nullableStringSchema,
  paused_reason: nullableStringSchema,
  pipeline_updated_at: timestampSchema,
  active_source_id: nullableStringSchema,
  active_source_title: nullableStringSchema,
  active_source_status: nullableStringSchema,
  active_vendor: nullableStringSchema,
  active_operating_system: nullableStringSchema,
  active_document_role: nullableStringSchema,
  queued_tasks: scalarNumberSchema,
  open_conflicts: scalarNumberSchema,
  feedback_24h: scalarNumberSchema,
  sources_total: scalarNumberSchema,
  sources_completed: scalarNumberSchema,
  fragments_total: scalarNumberSchema,
  candidates_total: scalarNumberSchema,
  failures_24h: scalarNumberSchema,
  completed_stages_24h: scalarNumberSchema,
  tokens_total: scalarNumberSchema,
  tokens_today: scalarNumberSchema,
  active_agent_runs: scalarNumberSchema,
  active_luna_executors: scalarNumberSchema,
  queued_expert: scalarNumberSchema,
  queued_verify: scalarNumberSchema,
  queued_analyze: scalarNumberSchema,
  queued_discover: scalarNumberSchema,
  tokens_per_revision: scalarNumberSchema,
  pause_pending: z.boolean(),
  published_records_24h: scalarNumberSchema,
  deployed_commit_sha: nullableStringSchema,
  processes: z.array(processSchema),
  active_work: activeWorkSchema.nullable(),
  pipeline_funnel: z.array(funnelStageSchema),
  breakdowns: z.object({
    vendor: z.array(breakdownRowSchema),
    operating_system: z.array(breakdownRowSchema),
    risk: z.array(breakdownRowSchema),
    origin: z.array(breakdownRowSchema)
  }),
  activity_30d: z.array(activityDaySchema),
  published_hourly_24h: z.array(hourlyPublishedSchema),
  recent_errors: z.array(pipelineErrorSchema)
})

export const coverageTargetSchema = z.object({
  id: z.string(),
  vendor_slug: z.string(),
  product_family: nullableStringSchema,
  model: nullableStringSchema,
  operating_system_slug: nullableStringSchema,
  version_branch: nullableStringSchema,
  document_role: z.string(),
  status: z.string(),
  priority: scalarNumberSchema,
  coverage_percent: scalarNumberSchema,
  next_check_at: timestampSchema,
  last_discovered_at: nullableStringSchema,
  last_completed_at: nullableStringSchema,
  source_count: scalarNumberSchema,
  completed_sources: scalarNumberSchema,
  failed_sources: scalarNumberSchema,
  created_at: timestampSchema,
  updated_at: timestampSchema
})

export const sourceSchema = z.object({
  id: z.string(),
  title: z.string(),
  document_type: z.string(),
  document_version: nullableStringSchema,
  document_date: nullableStringSchema,
  status: z.string(),
  content_hash: nullableStringSchema,
  failure_code: nullableStringSchema,
  failure_message: nullableStringSchema,
  discovered_at: timestampSchema,
  updated_at: timestampSchema,
  completed_at: nullableStringSchema,
  vendor_slug: z.string(),
  product_family: nullableStringSchema,
  model: nullableStringSchema,
  operating_system_slug: nullableStringSchema,
  version_branch: nullableStringSchema,
  document_role: z.string(),
  media_type: nullableStringSchema,
  byte_size: nullableScalarNumberSchema,
  page_count: nullableScalarNumberSchema,
  artifact_status: nullableStringSchema,
  fragments_total: scalarNumberSchema,
  fragments_completed: scalarNumberSchema
})

export const pipelineSettingsSchema = z.object({
  singleton: z.boolean(),
  enabled: z.boolean(),
  ai_model: z.string(),
  reasoning_effort: z.string(),
  max_concurrent_ai_runs: scalarNumberSchema,
  active_source_id: nullableStringSchema,
  active_coverage_target_id: nullableStringSchema.optional(),
  control_generation: scalarNumberSchema,
  pause_requested_at: nullableStringSchema,
  paused_reason: nullableStringSchema,
  updated_at: timestampSchema,
  updated_by: nullableStringSchema
})

export const pipelineTaskSchema = z.object({
  id: z.string(),
  task_type: z.string(),
  stage: z.string(),
  status: z.string(),
  priority: scalarNumberSchema,
  coverage_target_id: nullableStringSchema,
  source_candidate_id: nullableStringSchema,
  expert_task_id: nullableStringSchema,
  claim_owner: nullableStringSchema,
  lease_until: nullableStringSchema,
  heartbeat_at: nullableStringSchema,
  attempts: scalarNumberSchema,
  failure_code: nullableStringSchema,
  failure_message: nullableStringSchema,
  created_at: timestampSchema,
  updated_at: timestampSchema,
  completed_at: nullableStringSchema,
  result: z.record(z.string(), z.unknown()).nullable(),
  source_title: nullableStringSchema
})

export const pipelineEventSchema = z.object({
  id: z.string(),
  pipeline_task_id: nullableStringSchema,
  source_candidate_id: nullableStringSchema,
  stage: z.string(),
  event_type: z.string(),
  message: z.string(),
  metadata: z.record(z.string(), z.unknown()),
  created_at: timestampSchema
})

export const pipelineDetailsSchema = z.object({
  settings: pipelineSettingsSchema,
  tasks: z.array(pipelineTaskSchema),
  events: z.array(pipelineEventSchema)
})

export const sourceFragmentSchema = z.object({
  id: z.string(),
  ordinal: scalarNumberSchema,
  section_title: nullableStringSchema,
  source_locator: nullableStringSchema,
  content_hash: z.string(),
  status: z.string(),
  attempts: scalarNumberSchema,
  created_at: timestampSchema,
  updated_at: timestampSchema
})

export const knowledgeCandidateSchema = z.object({
  id: z.string(),
  stable_key: z.string(),
  status: z.string(),
  dangerous: z.boolean(),
  confidence: scalarNumberSchema,
  quality_score: scalarNumberSchema,
  revision_id: nullableStringSchema,
  created_at: timestampSchema,
  updated_at: timestampSchema
})

export const activeSourceDetailSchema = z.object({
  source: z.object({
    id: z.string(),
    title: z.string(),
    document_type: z.string(),
    document_version: nullableStringSchema,
    document_date: nullableStringSchema,
    status: z.string(),
    failure_code: nullableStringSchema,
    failure_message: nullableStringSchema,
    discovered_at: timestampSchema,
    updated_at: timestampSchema,
    completed_at: nullableStringSchema,
    vendor_slug: z.string(),
    product_family: nullableStringSchema,
    model: nullableStringSchema,
    operating_system_slug: nullableStringSchema,
    version_branch: nullableStringSchema,
    document_role: z.string(),
    artifact_id: nullableStringSchema,
    media_type: nullableStringSchema,
    byte_size: nullableScalarNumberSchema,
    page_count: nullableScalarNumberSchema,
    artifact_status: nullableStringSchema,
    acquired_at: nullableStringSchema,
    converted_at: nullableStringSchema,
    fragments_total: scalarNumberSchema,
    fragments_completed: scalarNumberSchema,
    candidates_total: scalarNumberSchema,
    candidates_verified: scalarNumberSchema
  }),
  fragments: z.array(sourceFragmentSchema),
  candidates: z.array(knowledgeCandidateSchema),
  events: z.array(pipelineEventSchema)
}).nullable()

export const knowledgeRevisionSchema = z.object({
  revision_id: z.string(),
  stable_key: z.string(),
  kind: z.string(),
  origin: z.string(),
  risk_level: z.string(),
  vendor_slug: z.string(),
  vendor_name: z.string(),
  platform_name: nullableStringSchema,
  operating_system_slug: nullableStringSchema,
  operating_system_name: nullableStringSchema,
  version_min: nullableStringSchema,
  version_max: nullableStringSchema,
  title: z.string(),
  summary: z.string(),
  dangerous: z.boolean(),
  confidence: scalarNumberSchema,
  quality_score: scalarNumberSchema,
  validation_level: z.string(),
  last_verified_at: timestampSchema,
  revision_created_at: timestampSchema
})

export const knowledgePageSchema = z.object({
  items: z.array(knowledgeRevisionSchema),
  total: scalarNumberSchema,
  limit: scalarNumberSchema,
  offset: scalarNumberSchema
})

export const importRunSchema = z.object({
  id: z.string(),
  source_label: z.string(),
  manifest_hash: nullableStringSchema,
  records_seen: scalarNumberSchema,
  records_quarantined: scalarNumberSchema,
  records_imported: scalarNumberSchema,
  records_published: scalarNumberSchema,
  records_failed: scalarNumberSchema,
  last_legacy_key: nullableStringSchema,
  status: z.string(),
  started_at: timestampSchema,
  completed_at: nullableStringSchema,
  error_message: nullableStringSchema,
  reconciled_items: scalarNumberSchema,
  mapped_revisions: scalarNumberSchema
})

export const agentRunSchema = z.object({
  id: z.string(),
  pipeline_task_id: nullableStringSchema,
  task_type: nullableStringSchema,
  stage: nullableStringSchema,
  model: z.string(),
  reasoning_effort: z.string(),
  status: z.string(),
  input_tokens: scalarNumberSchema,
  cached_input_tokens: scalarNumberSchema,
  output_tokens: scalarNumberSchema,
  reasoning_output_tokens: scalarNumberSchema,
  total_tokens: scalarNumberSchema,
  published_revisions: scalarNumberSchema,
  tokens_per_revision: nullableScalarNumberSchema,
  duration_ms: nullableScalarNumberSchema,
  error_code: nullableStringSchema,
  started_at: timestampSchema,
  completed_at: nullableStringSchema
})

export const expertTaskSchema = z.object({
  public_id: z.string(),
  tenant_id: nullableStringSchema,
  status: z.string(),
  priority: scalarNumberSchema,
  attempts: scalarNumberSchema,
  claim_owner: nullableStringSchema,
  lease_until: nullableStringSchema,
  expires_at: timestampSchema,
  created_at: timestampSchema,
  updated_at: timestampSchema,
  completed_at: nullableStringSchema,
  failure_code: nullableStringSchema,
  failure_message: nullableStringSchema,
  result_revision_id: nullableStringSchema,
  stage: nullableStringSchema,
  progress_percent: nullableScalarNumberSchema,
  public_message: nullableStringSchema,
  result_release_sequence: nullableScalarNumberSchema
})

export const conflictSchema = z.object({
  id: z.string(),
  left_revision_id: z.string(),
  right_revision_id: z.string(),
  severity: z.string(),
  description: z.string(),
  status: z.string(),
  created_at: timestampSchema,
  resolved_at: nullableStringSchema
})

export const releaseSchema = z.object({
  id: z.string(),
  sequence: scalarNumberSchema,
  status: z.string(),
  reason: z.string(),
  created_by: z.string(),
  created_at: timestampSchema,
  active: z.boolean(),
  revision_count: scalarNumberSchema
})

export const approvalSchema = z.object({
  id: z.string(),
  task_id: z.string(),
  repository: z.string(),
  summary: z.string(),
  risk_assessment: z.string(),
  status: z.string(),
  requested_by: z.string(),
  decided_by: nullableStringSchema,
  decision_reason: nullableStringSchema,
  created_at: timestampSchema,
  decided_at: nullableStringSchema
})

export const feedbackSchema = z.object({
  id: z.string(),
  revision_id: nullableStringSchema,
  task_id: nullableStringSchema,
  rating: z.number().nullable(),
  category: z.string(),
  comment: nullableStringSchema,
  created_at: timestampSchema
})

export const qualitySchema = z.object({
  summary: z.object({
    revisions: scalarNumberSchema,
    avg_confidence: nullableScalarNumberSchema,
    avg_quality: nullableScalarNumberSchema,
    dangerous_revisions: scalarNumberSchema,
    dangerous_below_threshold: scalarNumberSchema,
    regular_below_threshold: scalarNumberSchema
  }),
  eval_runs: z.array(z.object({
    id: scalarNumberSchema,
    suite: z.string(),
    commit_sha: nullableStringSchema,
    report_hash: z.string(),
    case_count: scalarNumberSchema,
    passed_count: scalarNumberSchema,
    failed_count: scalarNumberSchema,
    dangerous_false_safe: scalarNumberSchema,
    p50_ms: scalarNumberSchema,
    p95_ms: scalarNumberSchema,
    max_ms: scalarNumberSchema,
    executed_at: timestampSchema
  })),
  operation_latency_30d: z.array(z.object({
    operation: z.string(),
    requests: scalarNumberSchema,
    average_ms: nullableScalarNumberSchema
  })),
  conflicts: z.array(z.object({
    severity: z.string(),
    status: z.string(),
    count: scalarNumberSchema
  }))
})

export const labSchema = z.object({
  runs: z.array(z.object({
    id: z.string(),
    revision_id: z.string(),
    stable_key: z.string(),
    validation_type: z.string(),
    status: z.string(),
    fixture_key: z.string(),
    tool_version: z.string(),
    report_hash: z.string(),
    commit_sha: z.string(),
    summary: z.string(),
    executed_at: timestampSchema,
    expires_at: nullableStringSchema
  })),
  counts: z.array(z.object({
    validation_type: z.string(),
    status: z.string(),
    count: scalarNumberSchema
  }))
})

export const provenanceSchema = z.object({
  revision_id: z.string(),
  provenance: z.unknown(),
  created_at: timestampSchema,
  status: z.string()
})

export const mutationAckSchema = z.object({
  ok: z.literal(true),
  message: z.string(),
  audit_target: z.string().nullable()
})

export const coverageTargetsSchema = z.array(coverageTargetSchema)
export const sourcesSchema = z.array(sourceSchema)
export const importRunsSchema = z.array(importRunSchema)
export const agentRunsSchema = z.array(agentRunSchema)
export const expertTasksSchema = z.array(expertTaskSchema)
export const conflictsSchema = z.array(conflictSchema)
export const releasesSchema = z.array(releaseSchema)
export const approvalsSchema = z.array(approvalSchema)
export const feedbackRowsSchema = z.array(feedbackSchema)

export type Session = z.infer<typeof sessionSchema>
export type Overview = z.infer<typeof overviewSchema>
export type CoverageTarget = z.infer<typeof coverageTargetSchema>
export type Source = z.infer<typeof sourceSchema>
export type PipelineDetails = z.infer<typeof pipelineDetailsSchema>
export type PipelineTask = z.infer<typeof pipelineTaskSchema>
export type ActiveSourceDetail = z.infer<typeof activeSourceDetailSchema>
export type KnowledgePage = z.infer<typeof knowledgePageSchema>
export type KnowledgeRevision = z.infer<typeof knowledgeRevisionSchema>
export type ImportRun = z.infer<typeof importRunSchema>
export type AgentRun = z.infer<typeof agentRunSchema>
export type ExpertTask = z.infer<typeof expertTaskSchema>
export type Quality = z.infer<typeof qualitySchema>
export type Lab = z.infer<typeof labSchema>
export type Conflict = z.infer<typeof conflictSchema>
export type Release = z.infer<typeof releaseSchema>
export type Feedback = z.infer<typeof feedbackSchema>
export type Approval = z.infer<typeof approvalSchema>
export type Provenance = z.infer<typeof provenanceSchema>
export type MutationAck = z.infer<typeof mutationAckSchema>
