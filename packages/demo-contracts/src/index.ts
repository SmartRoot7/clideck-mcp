import { z } from 'zod'

const scalarSchema = z.union([z.number(), z.string()]).transform(Number)
const timestampSchema = z.union([z.string(), z.date()]).transform((value) =>
  new Date(value).toISOString()
)

const coverageSliceSchema = z.strictObject({
  key: z.string(),
  count: scalarSchema
})

const demoSampleSchema = z.strictObject({
  domain_id: z.string(),
  record_type: z.string(),
  title: z.string(),
  summary: z.string(),
  context: z.record(z.string(), z.unknown()),
  payload: z.record(z.string(), z.unknown()),
  confidence: scalarSchema,
  last_verified_at: z.union([z.string(), z.date()]).transform((value) =>
    new Date(value).toISOString().slice(0, 10)
  )
})

export const publicDemoSnapshotSchema = z.strictObject({
  generated_at: z.iso.datetime(),
  system: z.strictObject({
    status: z.enum(['healthy', 'degraded', 'paused']),
    pipeline_enabled: z.boolean(),
    healthy_workers: scalarSchema,
    total_workers: scalarSchema,
    configured_luna: scalarSchema,
    active_luna: scalarSchema,
    active_stage: z.string().nullable()
  }),
  release: z.strictObject({
    sequence: scalarSchema,
    published_at: timestampSchema,
    published_knowledge: scalarSchema,
    domains: scalarSchema,
    published_24h: scalarSchema
  }),
  published_hourly_24h: z.array(z.strictObject({
    hour: timestampSchema,
    published: scalarSchema
  })).length(24),
  growth_30d: z.array(z.strictObject({
    day: z.union([z.string(), z.date()]).transform((value) =>
      new Date(value).toISOString().slice(0, 10)
    ),
    published: scalarSchema,
    queries: scalarSchema,
    lab_validations: scalarSchema
  })).length(30),
  operations: z.strictObject({
    ai_model: z.string(),
    reasoning_effort: z.string(),
    pipeline_updated_at: timestampSchema,
    sources_total: scalarSchema,
    sources_completed: scalarSchema,
    fragments_total: scalarSchema,
    candidates_total: scalarSchema,
    failures_24h: scalarSchema,
    completed_stages_24h: scalarSchema,
    tokens_total: scalarSchema,
    tokens_today: scalarSchema,
    tokens_per_revision: scalarSchema,
    queued_expert: scalarSchema,
    queued_verify: scalarSchema,
    queued_analyze: scalarSchema,
    queued_discover: scalarSchema,
    queued_tasks: scalarSchema,
    open_conflicts: scalarSchema,
    feedback_24h: scalarSchema,
    executors: z.array(z.strictObject({
      id: z.string(),
      healthy: z.boolean(),
      heartbeat_at: timestampSchema,
      state: z.string(),
      stage: z.string()
    })).max(4),
    activity_30d: z.array(z.strictObject({
      day: timestampSchema,
      published: scalarSchema,
      revisions_created: scalarSchema,
      stages_completed: scalarSchema,
      tokens: scalarSchema
    })).length(30),
    breakdowns: z.strictObject({
      vendor: z.array(coverageSliceSchema),
      operating_system: z.array(coverageSliceSchema),
      risk: z.array(coverageSliceSchema),
      origin: z.array(coverageSliceSchema)
    })
  }),
  pipeline_funnel: z.array(z.strictObject({
    stage: z.string(),
    queued: scalarSchema,
    running: scalarSchema,
    completed: scalarSchema,
    failed: scalarSchema
  })).length(7),
  coverage: z.strictObject({
    domains: z.array(z.strictObject({
      id: z.string(),
      name: z.string(),
      records: scalarSchema,
      record_types: scalarSchema
    })),
    vendors: z.array(coverageSliceSchema),
    operating_systems: z.array(coverageSliceSchema),
    risks: z.array(coverageSliceSchema),
    targets: z.array(z.strictObject({
      vendor_slug: z.string(),
      product_family: z.string().nullable(),
      model: z.string().nullable(),
      operating_system_slug: z.string().nullable(),
      version_branch: z.string().nullable(),
      document_role: z.string(),
      status: z.string(),
      priority: scalarSchema,
      coverage_percent: scalarSchema,
      next_check_at: timestampSchema,
      last_discovered_at: timestampSchema.nullable(),
      last_completed_at: timestampSchema.nullable(),
      source_count: scalarSchema,
      completed_sources: scalarSchema,
      failed_sources: scalarSchema,
      created_at: timestampSchema,
      updated_at: timestampSchema
    })).max(500)
  }),
  pipeline_tasks: z.array(z.strictObject({
    task_type: z.string(),
    stage: z.string(),
    status: z.string(),
    priority: scalarSchema,
    lease_until: timestampSchema.nullable(),
    heartbeat_at: timestampSchema.nullable(),
    attempts: scalarSchema,
    created_at: timestampSchema,
    updated_at: timestampSchema,
    completed_at: timestampSchema.nullable()
  })).max(200),
  efficiency: z.strictObject({
    tokens_24h: scalarSchema,
    tokens_per_published_revision: scalarSchema,
    no_ai_answer_rate: z.number().min(0).max(1)
  }),
  evaluation: z.strictObject({
    suite: z.string(),
    cases: scalarSchema,
    passed: scalarSchema,
    failed: scalarSchema,
    dangerous_false_safe: scalarSchema,
    p95_ms: scalarSchema,
    executed_at: timestampSchema
  }).nullable(),
  quality: z.strictObject({
    summary: z.strictObject({
      revisions: scalarSchema,
      avg_confidence: scalarSchema.nullable(),
      avg_quality: scalarSchema.nullable(),
      dangerous_revisions: scalarSchema,
      dangerous_below_threshold: scalarSchema,
      regular_below_threshold: scalarSchema
    }),
    eval_runs: z.array(z.strictObject({
      suite: z.string(),
      case_count: scalarSchema,
      passed_count: scalarSchema,
      failed_count: scalarSchema,
      dangerous_false_safe: scalarSchema,
      p50_ms: scalarSchema,
      p95_ms: scalarSchema,
      max_ms: scalarSchema,
      executed_at: timestampSchema
    })).max(20),
    operation_latency_30d: z.array(z.strictObject({
      operation: z.string(),
      requests: scalarSchema,
      average_ms: scalarSchema.nullable()
    })),
    conflicts: z.array(z.strictObject({
      severity: z.string(),
      status: z.string(),
      count: scalarSchema
    }))
  }),
  samples: z.array(demoSampleSchema).max(4)
})

export type PublicDemoSnapshot = z.infer<typeof publicDemoSnapshotSchema>
