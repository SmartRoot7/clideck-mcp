import { z } from 'zod'

export const contextSchema = z.strictObject({
  topic: z.string().trim().min(1).max(120)
})

export const candidateSchema = z.strictObject({
  stable_key: z.string().regex(/^[a-z0-9][a-z0-9._-]{2,159}$/),
  topic: z.string().trim().min(1).max(120),
  title: z.string().trim().min(1).max(240),
  summary: z.string().trim().min(1).max(4_000),
  answer: z.string().trim().min(1).max(4_000),
  verification: z.array(z.string().trim().min(1).max(1_000)).min(1),
  confidence: z.number().min(0.9).max(1),
  quality_score: z.number().min(0).max(1),
  last_verified_at: z.iso.date()
})

export const publicRecordSchema = z.strictObject({
  title: z.string(),
  summary: z.string(),
  answer: z.string(),
  topic: z.string(),
  confidence: z.number().min(0).max(1)
})

export type PackContext = z.infer<typeof contextSchema>
export type PackCandidate = z.infer<typeof candidateSchema>
export type PackPublicRecord = z.infer<typeof publicRecordSchema>
