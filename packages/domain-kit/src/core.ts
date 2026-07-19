import { z } from 'zod'

import {
  domainIdSchema,
  extensionIdSchema
} from './manifest.js'
import {
  jsonObjectSchema,
  type JsonObject
} from './json.js'

const boundedLine = z.string().trim().min(1).max(1_000)

export const coreProvenanceSchema = z.strictObject({
  url: z.url().startsWith('https://'),
  document_type: z.string().trim().min(1).max(80),
  title: z.string().trim().min(1).max(240),
  document_version: z.string().trim().min(1).max(120).optional(),
  document_date: z.iso.date().optional(),
  verified_at: z.iso.date(),
  content_hash: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  evidence_fragment: z.string().trim().min(1).max(600),
  evidence_role: z.enum([
    'primary',
    'corroborating',
    'conflict'
  ]).default('primary')
})

export const coreRiskLevelSchema = z.enum([
  'safe_read_only',
  'changes_state',
  'credential_sensitive',
  'service_disruptive',
  'data_loss',
  'physical_harm',
  'unknown'
])

export const coreKnowledgeCandidateSchema = z.strictObject({
  domain_id: domainIdSchema,
  schema_version: z.string().trim().min(1).max(40),
  stable_key: z.string().regex(
    /^[a-z0-9][a-z0-9._-]{2,159}$/,
  ),
  record_type: extensionIdSchema,
  title: z.string().trim().min(1).max(240),
  summary: z.string().trim().min(1).max(4_000),
  question_patterns: z.array(
    z.string().trim().min(3).max(300),
  ).min(1).max(30),
  context: jsonObjectSchema,
  payload: jsonObjectSchema,
  prerequisites: z.array(boundedLine).max(30).default([]),
  risks: z.array(boundedLine).max(30).default([]),
  verification: z.array(boundedLine).min(1).max(30),
  rollback: z.array(boundedLine).max(30).default([]),
  limitations: z.array(boundedLine).max(30).default([]),
  dangerous: z.boolean(),
  risk_level: coreRiskLevelSchema,
  confidence: z.number().min(0).max(1),
  quality_score: z.number().min(0).max(1),
  confidence_reason: z.string().trim().min(10).max(2_000),
  last_verified_at: z.iso.date(),
  provenance: z.array(coreProvenanceSchema).min(1).max(10)
})

export const coreKnowledgeRevisionSchema =
  coreKnowledgeCandidateSchema.extend({
    revision_ref: z.uuid(),
    revision_number: z.number().int().positive(),
    release_sequence: z.number().int().positive(),
    assurance: z.strictObject({
      validation_level: extensionIdSchema,
      independent_confirmations: z.number().int().min(1).max(100),
      next_review_at: z.iso.date()
    }),
    conflicts: z.array(z.strictObject({
      severity: z.enum(['informational', 'warning', 'blocking']),
      description: z.string().trim().min(1).max(1_000)
    }))
  })

export type CoreKnowledgeCandidate = z.infer<
  typeof coreKnowledgeCandidateSchema
>
export type CoreKnowledgeRevision = z.infer<
  typeof coreKnowledgeRevisionSchema
>

export class CorePolicyError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'CorePolicyError'
    this.code = code
  }
}

export function enforceCoreCandidatePolicy(
  input: unknown,
): CoreKnowledgeCandidate {
  const candidate = coreKnowledgeCandidateSchema.parse(input)
  const confidenceThreshold = candidate.dangerous ? 0.95 : 0.9
  if (candidate.confidence < confidenceThreshold) {
    throw new CorePolicyError(
      'CONFIDENCE_BELOW_PUBLICATION_THRESHOLD',
      `Confidence must be at least ${confidenceThreshold.toFixed(2)}.`,
    )
  }
  if (candidate.dangerous && candidate.rollback.length === 0) {
    throw new CorePolicyError(
      'DANGEROUS_CANDIDATE_REQUIRES_ROLLBACK',
      'Dangerous candidates require an explicit rollback procedure.',
    )
  }
  if (
    candidate.dangerous &&
    candidate.risk_level === 'safe_read_only'
  ) {
    throw new CorePolicyError(
      'DANGEROUS_CANDIDATE_FALSE_SAFE',
      'A dangerous candidate cannot be classified as safe_read_only.',
    )
  }
  return candidate
}

export function coreCandidateWith(
  value: CoreKnowledgeCandidate,
  overrides: Partial<{
    context: JsonObject
    payload: JsonObject
  }>,
): CoreKnowledgeCandidate {
  return enforceCoreCandidatePolicy({
    ...value,
    ...overrides
  })
}
