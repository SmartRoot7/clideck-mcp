import { z } from 'zod'

import type {
  CoreKnowledgeCandidate,
  CorePublicKnowledgeRevision
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

export type DeterministicExtractionFragment = {
  id: string
  ordinal: number
  section_title: string | null
  source_locator: string | null
  content: string
  content_hash: string
}

export type DeterministicExtractionInput = {
  fragments: DeterministicExtractionFragment[]
  source: {
    canonical_url: string
    document_type: string
    title: string
    document_version: string | null
    document_date: string | null
  }
  context: Record<string, string | null>
  verified_at: string
}

export type DeterministicExtractionResult<Candidate> = {
  candidates: Array<{
    fragment_id: string
    candidate: Candidate
  }>
  handled_fragment_ids: string[]
}

export interface DeterministicExtractor<Candidate> {
  readonly id: string
  readonly max_fragments_per_batch: number
  supports(input: DeterministicExtractionInput): boolean
  extract(
    input: DeterministicExtractionInput,
  ): DeterministicExtractionResult<Candidate>
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
  readonly deterministicExtractor?: DeterministicExtractor<Candidate>
  normalizeContext(input: unknown): Context
  validateCandidate(candidate: Candidate): DomainValidationResult
  toCoreCandidate(candidate: Candidate): CoreKnowledgeCandidate
  fromCoreRevision(revision: CorePublicKnowledgeRevision): PublicRecord
}
