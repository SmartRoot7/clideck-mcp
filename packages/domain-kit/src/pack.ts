import { z } from 'zod'

import type {
  CoreKnowledgeCandidate,
  CoreKnowledgeRevision
} from './core.js'
import type { DomainPackManifestV1 } from './manifest.js'

export type DomainValidationIssue = {
  code: string
  message: string
  path?: string
}

export type DomainValidationResult = {
  valid: boolean
  issues: DomainValidationIssue[]
}

export interface DomainPack<
  Context extends Record<string, unknown> = Record<string, unknown>,
  Candidate = unknown,
  PublicRecord = unknown
> {
  readonly manifest: DomainPackManifestV1
  readonly contextSchema: z.ZodType<Context>
  readonly candidateSchema: z.ZodType<Candidate>
  readonly publicRecordSchema: z.ZodType<PublicRecord>
  normalizeContext(input: unknown): Context
  validateCandidate(candidate: Candidate): DomainValidationResult
  toCoreCandidate(candidate: Candidate): CoreKnowledgeCandidate
  fromCoreRevision(revision: CoreKnowledgeRevision): PublicRecord
}
