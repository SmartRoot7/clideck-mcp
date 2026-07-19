import {
  domainIdSchema,
  domainPackManifestV1Schema,
  jsonObjectSchema
} from '@clideck/domain-kit'
import { z } from 'zod'

export const listKnowledgeDomainsInputSchema = z.strictObject({})

export const listKnowledgeDomainsOutputSchema = z.strictObject({
  domains: z.array(domainPackManifestV1Schema)
})

export const describeKnowledgeDomainInputSchema = z.strictObject({
  domain_id: domainIdSchema
})

export const describeKnowledgeDomainOutputSchema = z.strictObject({
  manifest: domainPackManifestV1Schema,
  schemas: z.strictObject({
    context: jsonObjectSchema,
    public_record: jsonObjectSchema
  })
})

export const queryDomainKnowledgeInputSchema = z.strictObject({
  domain_id: domainIdSchema,
  question: z.string().trim().min(3).max(2_000),
  context: jsonObjectSchema,
  limit: z.number().int().min(1).max(20).default(5)
})

export const queryDomainKnowledgeOutputSchema = z.strictObject({
  domain_id: domainIdSchema,
  context: jsonObjectSchema,
  answers: z.array(jsonObjectSchema),
  unknown: z.boolean(),
  next_action: z.enum(['use_answer', 'knowledge_not_found'])
})
