import { z } from 'zod'

import { networkVersionSchema } from '../version.js'

const shortText = z.string().trim().min(1).max(240)
const boundedText = z.string().trim().min(1).max(2_000)

export const networkContextInputSchema = z.object({
  vendor: shortText.optional(),
  model: shortText.optional(),
  operating_system: shortText.optional(),
  version: networkVersionSchema.optional()
}).refine(
  (value) => value.vendor || value.model || value.operating_system,
  'At least one of vendor, model, or operating_system is required',
)

export type NetworkContextInput = z.infer<typeof networkContextInputSchema>

export const resolvedNetworkContextSchema = z.object({
  vendor: z.string(),
  vendor_slug: z.string(),
  model: z.string().nullable(),
  platform_slug: z.string().nullable(),
  operating_system: z.string(),
  operating_system_slug: z.string(),
  version: z.string().nullable(),
  applicable_version: z.string(),
  resolution_confidence: z.number().min(0).max(1),
  ambiguities: z.array(z.string())
})

export type ResolvedNetworkContext = z.infer<
  typeof resolvedNetworkContextSchema
>

export const queryKnowledgeInputSchema = z.object({
  question: boundedText.min(3),
  context: networkContextInputSchema,
  limit: z.number().int().min(1).max(5).default(3)
})

export const getWorkflowInputSchema = z.object({
  goal: boundedText.min(3),
  context: networkContextInputSchema,
  limit: z.number().int().min(1).max(3).default(1)
})

export const publicKnowledgeSchema = z.object({
  revision_ref: z.string().uuid(),
  kind: z.enum(['command', 'workflow', 'diagnostic', 'concept']),
  title: z.string(),
  summary: z.string(),
  applicability: z.object({
    vendor: z.string(),
    model: z.string().nullable(),
    operating_system: z.string(),
    versions: z.object({
      minimum: z.string().nullable(),
      maximum: z.string().nullable(),
      requested: z.string().nullable()
    })
  }),
  cli_mode: z.string().nullable(),
  command: z.string().nullable(),
  procedure: z.array(z.string()),
  prerequisites: z.array(z.string()),
  risks: z.array(z.string()),
  verification: z.array(z.string()),
  rollback: z.array(z.string()),
  last_verified_at: z.string(),
  confidence: z.number().min(0).max(1),
  quality_score: z.number().min(0).max(1),
  dangerous: z.boolean(),
  conflicts: z.array(z.object({
    severity: z.enum(['informational', 'warning', 'blocking']),
    description: z.string()
  })),
  limitations: z.array(z.string())
})

export type PublicKnowledge = z.infer<typeof publicKnowledgeSchema>

export const knowledgeSearchResultSchema = z.object({
  context: resolvedNetworkContextSchema,
  answers: z.array(publicKnowledgeSchema),
  unknown: z.boolean(),
  next_action: z
    .enum(['use_answer', 'request_expert_answer'])
})

export const requestExpertAnswerInputSchema = z.object({
  question: boundedText.min(8),
  context: networkContextInputSchema
})

export const taskCredentialsSchema = z.object({
  task_id: z.string().regex(/^ekt_[A-Za-z0-9_-]{32}$/),
  access_token: z.string().min(32).max(128).optional()
})

export const continueTaskInputSchema = taskCredentialsSchema.extend({
  message: boundedText
})

export const taskStatusSchema = z.object({
  task_id: z.string(),
  status: z.enum([
    'queued',
    'claimed',
    'researching',
    'input_required',
    'validating',
    'completed',
    'failed',
    'cancelled',
    'expired'
  ]),
  created_at: z.string(),
  expires_at: z.string(),
  input_request: z.string().nullable(),
  answer: publicKnowledgeSchema.nullable(),
  failure: z.object({
    code: z.string(),
    message: z.string()
  }).nullable(),
  poll_after_ms: z.number().int()
})

export const createdTaskStatusSchema = taskStatusSchema.extend({
  access_token: z.string().min(32).max(128).optional()
})

export const feedbackInputSchema = z.object({
  revision_ref: z.string().uuid().optional(),
  task_id: z.string().regex(/^ekt_[A-Za-z0-9_-]{32}$/).optional(),
  access_token: z.string().min(32).max(128).optional(),
  rating: z.number().int().min(-1).max(1).optional(),
  category: z.enum([
    'correct',
    'incorrect',
    'outdated',
    'unsafe',
    'incomplete',
    'other'
  ]),
  comment: z.string().trim().min(1).max(2_000).optional()
}).refine(
  (value) => value.revision_ref || value.task_id,
  'revision_ref or task_id is required',
)

export const feedbackOutputSchema = z.object({
  accepted: z.literal(true),
  feedback_id: z.string().uuid()
})

export const candidateRevisionSchema = z.object({
  task_id: z.string().regex(/^ekt_[A-Za-z0-9_-]{32}$/),
  lease_token: z.string().min(32).max(128),
  stable_key: z.string().regex(/^[a-z0-9][a-z0-9._-]{2,159}$/),
  kind: z.enum(['command', 'workflow', 'diagnostic', 'concept']),
  vendor_slug: z.string().regex(/^[a-z0-9][a-z0-9-]{1,62}$/),
  platform_slug: z.string().regex(/^[a-z0-9][a-z0-9-]{1,62}$/).optional(),
  operating_system_slug: z.string().regex(/^[a-z0-9][a-z0-9-]{1,62}$/),
  version_min: networkVersionSchema.optional(),
  version_max: networkVersionSchema.optional(),
  title: shortText,
  summary: z.string().trim().min(1).max(4_000),
  question_patterns: z.array(z.string().trim().min(3).max(300)).min(1).max(20),
  cli_mode: z.string().trim().min(1).max(120).optional(),
  command: z.string().trim().min(1).max(2_000).optional(),
  procedure: z.array(z.string().trim().min(1).max(1_000)).max(50).default([]),
  prerequisites: z.array(z.string().trim().min(1).max(1_000)).max(30).default([]),
  risks: z.array(z.string().trim().min(1).max(1_000)).max(30).default([]),
  verification: z.array(z.string().trim().min(1).max(1_000)).min(1).max(30),
  rollback: z.array(z.string().trim().min(1).max(1_000)).max(30).default([]),
  limitations: z.array(z.string().trim().min(1).max(1_000)).max(30).default([]),
  dangerous: z.boolean(),
  confidence: z.number().min(0).max(1),
  quality_score: z.number().min(0).max(1),
  confidence_reason: z.string().trim().min(10).max(2_000),
  last_verified_at: z.iso.date(),
  provenance: z.array(z.object({
    url: z.url().startsWith('https://'),
    document_type: z.string().trim().min(1).max(80),
    title: shortText,
    document_version: z.string().trim().max(120).optional(),
    document_date: z.iso.date().optional(),
    verified_at: z.iso.date(),
    content_hash: z.string().regex(/^sha256:[0-9a-f]{64}$/),
    evidence_fragment: z.string().trim().min(1).max(600),
    evidence_role: z.enum(['primary', 'corroborating', 'conflict']).default('primary')
  })).min(1).max(10)
})

export type CandidateRevision = z.infer<typeof candidateRevisionSchema>
