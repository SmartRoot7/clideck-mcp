import { z } from 'zod'

export const executionProtocolVersion = 2
export const executionModelSchema = z.string().min(2).max(120)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]+$/)
// Ultra can delegate automatically, outside the restricted executor budget.
export const executionReasoningSchema = z.enum([
  'none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'
])
export const executionProfileIdSchema = z.enum(['luna', 'luna_high'])
export const executionProfileSchema = z.object({
  profile_id: executionProfileIdSchema,
  model: executionModelSchema,
  reasoning_effort: executionReasoningSchema,
  fallback_model: executionModelSchema.nullable(),
  fallback_reasoning_effort: executionReasoningSchema.nullable()
}).strict().refine((profile) =>
  Boolean(profile.fallback_model) === Boolean(profile.fallback_reasoning_effort),
{ message: 'Fallback model and reasoning must be selected together' })
export const executionSettingsInputSchema = z.object({
  expected_version: z.number().int().min(1),
  max_concurrent_ai_runs: z.number().int().min(1).max(8),
  profiles: z.array(executionProfileSchema).length(2)
}).strict().refine((settings) =>
  new Set(settings.profiles.map((profile) => profile.profile_id)).size === 2,
{ message: 'Both execution profiles are required' })
export const executionSettingsSchema = z.object({
  settings_version: z.number().int(),
  max_concurrent_ai_runs: z.number().int(),
  enabled: z.boolean(),
  active_runs: z.number().int(),
  draining_runs: z.number().int(),
  profiles: z.array(executionProfileSchema)
})
export const executionCatalogModelSchema = z.object({
  model: executionModelSchema,
  display_name: z.string().min(1).max(160),
  description: z.string().max(1000).default(''),
  reasoning_efforts: z.array(executionReasoningSchema).min(1).max(7),
  default_reasoning_effort: executionReasoningSchema
}).strict()
export const executionCatalogReportSchema = z.object({
  protocol_version: z.literal(executionProtocolVersion),
  cli_version: z.string().min(1).max(100),
  models: z.array(executionCatalogModelSchema).max(100),
  error: z.enum(['CODEX_BINARY_UNAVAILABLE', 'CODEX_INCOMPATIBLE', 'CODEX_CATALOG_UNAVAILABLE']).nullable(),
  supports_structured_output: z.boolean(),
  supports_web_research: z.boolean()
}).strict()
export const executionModelRetrySchema = z.object({
  profile_id: executionProfileIdSchema,
  model: executionModelSchema,
  reasoning_effort: executionReasoningSchema
}).strict()
export const executionCatalogSchema = executionCatalogReportSchema.extend({
  updated_at: z.string().nullable(),
  last_success_at: z.string().nullable(),
  stale: z.boolean()
})
export const modelPriceSchema = z.object({
  display_name: z.string(),
  model: z.string(),
  input: z.number().nonnegative(),
  cached_input: z.number().nonnegative(),
  output: z.number().nonnegative()
})
export const modelPricingSchema = z.object({
  unit: z.literal('credits_per_million_tokens'),
  speed: z.literal('standard'),
  source_url: z.string().url(),
  updated_at: z.string().nullable(),
  checked_at: z.string().nullable(),
  stale: z.boolean(),
  error: z.string().nullable(),
  prices: z.array(modelPriceSchema)
})
export const modelMetricsSchema = z.object({
  model: z.string(),
  reasoning_effort: z.string(),
  runs: z.number().int(),
  completed: z.number().int(),
  failed: z.number().int(),
  avg_duration_ms: z.number().nullable(),
  input_tokens: z.number(),
  cached_input_tokens: z.number(),
  output_tokens: z.number(),
  reasoning_output_tokens: z.number(),
  quality_checks: z.number().int(),
  material_errors: z.number().int()
})
export const executionModelsSchema = z.object({
  catalog: executionCatalogSchema,
  pricing: modelPricingSchema,
  metrics: z.array(modelMetricsSchema),
  circuits: z.array(z.object({
    execution_profile: executionProfileIdSchema,
    task_type: z.string(), model: z.string(), reasoning_effort: z.string(),
    open_until: z.string(), configuration_error: z.boolean()
  }))
})
export type ExecutionProfile = z.infer<typeof executionProfileSchema>
export type ExecutionSettings = z.infer<typeof executionSettingsSchema>
export type ExecutionSettingsInput = z.infer<typeof executionSettingsInputSchema>
export type ExecutionReasoning = z.infer<typeof executionReasoningSchema>
export type ExecutionCatalogReport = z.infer<typeof executionCatalogReportSchema>
export type ExecutionModels = z.infer<typeof executionModelsSchema>
export type ModelPrice = z.infer<typeof modelPriceSchema>
