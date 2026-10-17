import { z } from 'zod'
import { coreKnowledgeCandidateSchema, corePublicKnowledgeRevisionSchema } from '@clideck/domain-kit'

const text = z.string().trim().min(1).max(240)
const line = z.string().trim().min(1).max(1000)
const component = z.string().trim().min(1).max(120)

// Published context contains documented applicability only. The requested
// environment and original question stay in the private learning ledger.
export const contextSchema = z.strictObject({
  operating_system: text.optional(),
  operating_system_version: text.optional(),
  component: component.optional(),
  component_version: text.optional(),
  shell_environment: text.optional()
})
export const payloadSchema = z.strictObject({
  answer: z.string().trim().min(1).max(8000),
  procedure: z.array(line).max(40),
  command: z.string().trim().min(1).max(2000).optional(),
  documented_components: z.array(z.strictObject({
    name: component,
    version: text.optional(),
    applicability: line
  })).min(1).max(12)
})
export const candidateSchema = coreKnowledgeCandidateSchema.extend({
  domain_id: z.literal('technical-operations'),
  schema_version: z.literal('1'),
  record_type: z.enum(['command','workflow','diagnostic','concept','change','upgrade']),
  context: contextSchema,
  payload: payloadSchema
})
export const publicRecordSchema = corePublicKnowledgeRevisionSchema.extend({
  domain_id: z.literal('technical-operations'),
  schema_version: z.literal('1'),
  context: contextSchema,
  payload: payloadSchema
})
export type PackContext = z.infer<typeof contextSchema>
export type PackCandidate = z.infer<typeof candidateSchema>
export type PackPublicRecord = z.infer<typeof publicRecordSchema>

const explanation = z.string().trim().min(3).max(1000)
export const answerDraftSchema = z.strictObject({
  question_key: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  answer_status: z.enum(['complete','partial','unknown']),
  covered_capabilities: z.array(z.string().trim().min(1).max(120)).max(20),
  candidate: candidateSchema.nullable(),
  missing_capabilities: z.array(z.string().trim().min(1).max(120)).max(20),
  missing_context: z.array(explanation).max(10),
  next_searches: z.array(explanation).max(12),
  reason: explanation
})
export const answerReviewSchema = answerDraftSchema.extend({ approved:z.boolean() })
export type TechnicalAnswerDraft = z.infer<typeof answerDraftSchema>
export type TechnicalAnswerReview = z.infer<typeof answerReviewSchema>
