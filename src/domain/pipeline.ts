import { z } from 'zod'

import { enforceCoreCandidatePolicy } from '@clideck/domain-kit'

import type { AppConfig } from '../config.js'
import {
  randomUrlToken,
  sha256,
  sha256Label
} from '../crypto.js'
import type { Database, DatabaseClient } from '../db.js'
import { withTransaction } from '../db.js'
import { assertSafeProvenanceUrl } from '../security/url-policy.js'
import { normalizeVendorVersion } from '../version.js'
import {
  fillWeightedAiCapacity,
  type WeightedAiStage
} from './pipeline-scheduler.js'
import { getNetworkDomainPack } from './domain-packs.js'
import {
  recordPipelineTransition,
  recordPipelineTransitions
} from './pipeline-transitions.js'
import {
  isRelevantToKnowledgeDemand,
  knowledgeDemandTermPatterns
} from './knowledge-demand-relevance.js'
import { omitNullObjectProperties } from './structured-output.js'
import { candidateRevisionSchema } from './schemas.js'
import { candidateKnowledgeSchema } from './publication.js'
import { enforceKnowledgeRisk } from './risk.js'

const pipelineLeaseSchema = z.object({
  pipeline_task_id: z.string().uuid(),
  lease_token: z.string().min(32).max(128)
})

export const discoverySourceSchema = z.object({
  canonical_url: z.url().startsWith('https://'),
  document_type: z.string().trim().min(1).max(80),
  title: z.string().trim().min(1).max(500),
  document_version: z.string().trim().min(1).max(160).optional(),
  document_date: z.iso.date().optional()
})

const pipelineSourcePayloadSchema = z.object({
  canonical_url: z.url().startsWith('https://'),
  document_type: z.string().trim().min(1).max(80),
  title: z.string().trim().min(1).max(500),
  document_version: z.string().trim().min(1).max(160).nullable().optional(),
  document_date: z.iso.date().nullable().optional()
})

const discoveryArtifactShape = {
  sources: z.array(discoverySourceSchema).max(25),
  rejection_reason: z.string().trim().min(12).max(1_000).optional()
}
const hasDiscoveryResult = (
  value: z.infer<z.ZodObject<typeof discoveryArtifactShape>>,
) => value.sources.length > 0 || Boolean(value.rejection_reason)

export const discoveryArtifactSchema = z.object(discoveryArtifactShape).refine(
  hasDiscoveryResult,
  'A discovery run must submit a source or an explicit rejection reason.',
)

export const discoverySubmissionSchema = pipelineLeaseSchema.extend(
  discoveryArtifactShape,
).refine(
  (value) => value.sources.length > 0 || Boolean(value.rejection_reason),
  'A discovery run must submit a source or an explicit rejection reason.',
)

export const pipelineCandidatePayloadSchema = candidateRevisionSchema.omit({
  task_id: true,
  lease_token: true
})

const candidateAnalysisArtifactShape = {
  candidates: z.array(z.object({
    fragment_id: z.string().uuid(),
    candidate: pipelineCandidatePayloadSchema
  })).max(50),
  rejected_fragments: z.array(z.object({
    fragment_id: z.string().uuid(),
    reason: z.string().trim().min(8).max(500)
  })).max(50).default([])
}
const requireHandledAnalysisArtifact = (
  value: z.infer<z.ZodObject<typeof candidateAnalysisArtifactShape>>,
  context: z.RefinementCtx,
) => {
  const handled = new Set([
    ...value.candidates.map((entry) => entry.fragment_id),
    ...value.rejected_fragments.map((entry) => entry.fragment_id)
  ])
  if (handled.size === 0) {
    context.addIssue({
      code: 'custom',
      message:
        'Every analysis run must create a candidate or explicitly reject a fragment.'
    })
  }
}

export const candidateAnalysisArtifactSchema = z.object(
  candidateAnalysisArtifactShape,
).superRefine(requireHandledAnalysisArtifact)

const stableKeyPattern = /^[a-z0-9][a-z0-9._-]{2,159}$/

function normalizeStableKey(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[^a-z0-9]+/, '')
    .replace(/[._-]{2,}/g, '-')
    .replace(/[._-]+$/, '')
    .slice(0, 160)
    .replace(/[._-]+$/, '')

  return stableKeyPattern.test(normalized) ? normalized : value
}

export function normalizeCandidateAnalysisStableKeys(
  unparsedArtifact: unknown,
): unknown {
  if (
    !unparsedArtifact ||
    typeof unparsedArtifact !== 'object' ||
    Array.isArray(unparsedArtifact)
  ) {
    return unparsedArtifact
  }

  const artifact = unparsedArtifact as Record<string, unknown>
  if (!Array.isArray(artifact['candidates'])) return unparsedArtifact

  return {
    ...artifact,
    candidates: artifact['candidates'].map((entry) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        return entry
      }
      const candidateEntry = entry as Record<string, unknown>
      const candidate = candidateEntry['candidate']
      if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
        return entry
      }
      const candidateRecord = candidate as Record<string, unknown>
      const stableKey = candidateRecord['stable_key']
      if (typeof stableKey !== 'string') return entry

      return {
        ...candidateEntry,
        candidate: {
          ...candidateRecord,
          stable_key: normalizeStableKey(stableKey)
        }
      }
    })
  }
}

export function normalizeCandidateAnalysisOptionalFields(
  unparsedArtifact: unknown,
): unknown {
  if (
    !unparsedArtifact ||
    typeof unparsedArtifact !== 'object' ||
    Array.isArray(unparsedArtifact)
  ) {
    return unparsedArtifact
  }

  const artifact = unparsedArtifact as Record<string, unknown>
  if (!Array.isArray(artifact['candidates'])) return unparsedArtifact

  return {
    ...artifact,
    candidates: artifact['candidates'].map((entry) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        return entry
      }
      const candidateEntry = entry as Record<string, unknown>
      const candidate = candidateEntry['candidate']
      if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
        return entry
      }
      const candidateRecord = candidate as Record<string, unknown>
      const cliMode = candidateRecord['cli_mode']
      if (typeof cliMode !== 'string') return entry

      const compactCliMode = cliMode.replace(/\s+/g, ' ').trim()
      const normalizedCandidate = { ...candidateRecord }
      if (compactCliMode.length === 0 || compactCliMode.length > 120) {
        delete normalizedCandidate['cli_mode']
      } else {
        normalizedCandidate['cli_mode'] = compactCliMode
      }
      return {
        ...candidateEntry,
        candidate: normalizedCandidate
      }
    })
  }
}

export function bindCandidateAnalysisProvenanceHashes(
  unparsedArtifact: unknown,
  unparsedFragments: unknown,
): unknown {
  if (
    !unparsedArtifact ||
    typeof unparsedArtifact !== 'object' ||
    Array.isArray(unparsedArtifact) ||
    !Array.isArray(unparsedFragments)
  ) {
    return unparsedArtifact
  }

  const fragmentHashes = new Map<string, string>()
  for (const fragment of unparsedFragments) {
    if (!fragment || typeof fragment !== 'object' || Array.isArray(fragment)) {
      continue
    }
    const record = fragment as Record<string, unknown>
    if (
      typeof record['id'] === 'string' &&
      typeof record['content_hash'] === 'string' &&
      /^sha256:[0-9a-f]{64}$/.test(record['content_hash'])
    ) {
      fragmentHashes.set(record['id'], record['content_hash'])
    }
  }

  const artifact = unparsedArtifact as Record<string, unknown>
  if (!Array.isArray(artifact['candidates'])) return unparsedArtifact

  return {
    ...artifact,
    candidates: artifact['candidates'].map((entry) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        return entry
      }
      const candidateEntry = entry as Record<string, unknown>
      const trustedHash = typeof candidateEntry['fragment_id'] === 'string'
        ? fragmentHashes.get(candidateEntry['fragment_id'])
        : undefined
      const candidate = candidateEntry['candidate']
      if (
        !trustedHash ||
        !candidate ||
        typeof candidate !== 'object' ||
        Array.isArray(candidate)
      ) {
        return entry
      }
      const candidateRecord = candidate as Record<string, unknown>
      if (!Array.isArray(candidateRecord['provenance'])) return entry

      return {
        ...candidateEntry,
        candidate: {
          ...candidateRecord,
          provenance: candidateRecord['provenance'].map((source) =>
            source && typeof source === 'object' && !Array.isArray(source)
              ? {
                  ...(source as Record<string, unknown>),
                  content_hash: trustedHash
                }
              : source,
          )
        }
      }
    })
  }
}

export const candidateAnalysisSubmissionSchema = pipelineLeaseSchema.extend(
  candidateAnalysisArtifactShape,
).superRefine(requireHandledAnalysisArtifact)

const candidateVerificationDecisionShape = {
  decision: z.enum([
    'verified',
    'rejected',
    'conflict',
    'deep_review'
  ]),
  confidence: z.number().min(0).max(1),
  quality_score: z.number().min(0).max(1),
  findings: z.array(
    z.string().trim().min(1).max(1_000),
  ).max(30).default([])
}

const candidateVerificationArtifactShape = {
  decisions: z.array(z.object({
    candidate_id: z.string().uuid(),
    ...candidateVerificationDecisionShape
  })).min(1).max(100)
}

export const candidateVerificationArtifactSchema = z.object(
  candidateVerificationArtifactShape,
)

export const candidateVerificationSubmissionSchema =
  pipelineLeaseSchema.extend(candidateVerificationArtifactShape)

export const candidateVerificationAgentArtifactSchema = z.object({
  decisions: z.array(z.object({
    candidate_index: z.number().int().min(0).max(99),
    ...candidateVerificationDecisionShape
  })).min(1).max(100)
})

const candidateDeepReviewDecisionShape = {
  decision: z.enum([
    'verified',
    'rejected',
    'conflict',
    'unresolved'
  ]),
  confidence: z.number().min(0).max(1),
  quality_score: z.number().min(0).max(1),
  findings: z.array(z.string().trim().min(1).max(1_000)).max(30)
    .default([])
}

// Deep review may repair the structured claim, but not its source identity or
// evidence. Returning a full candidate for a one-field repair was the largest
// Medium Review response surface and made single-record reviews needlessly
// expensive. The server retains the leased candidate and applies only a
// validated patch before the normal strict Domain Pack and risk checks.
const deepReviewClearableFields = [
  'platform_slug',
  'version_min',
  'version_max',
  'cli_mode',
  'command'
] as const

const candidateDeepReviewRepairPatchSchema = z.object({
  changes: pipelineCandidatePayloadSchema
    .omit({ provenance: true })
    .partial(),
  clear: z.array(z.enum(deepReviewClearableFields)).max(
    deepReviewClearableFields.length,
  ).default([])
}).superRefine((repair, context) => {
  if (Object.keys(repair.changes).length === 0 && repair.clear.length === 0) {
    context.addIssue({
      code: 'custom',
      message: 'A deep-review repair must change or clear at least one field.',
    })
  }
  for (const field of repair.clear) {
    if (repair.changes[field] !== undefined && repair.changes[field] !== null) {
      context.addIssue({
        code: 'custom',
        message: `A deep-review field cannot be changed and cleared: ${field}.`,
      })
    }
  }
})

const candidateDeepReviewRepairShape = candidateDeepReviewRepairPatchSchema
  .nullable()
  .default(null)

const candidateDeepReviewSubmissionDecisionShape = {
  ...candidateDeepReviewDecisionShape,
  repaired_candidate: candidateDeepReviewRepairShape
}

const candidateDeepReviewArtifactShape = {
  decisions: z.array(z.object({
    candidate_id: z.string().uuid(),
    ...candidateDeepReviewSubmissionDecisionShape
  })).min(1).max(20)
}

export const candidateDeepReviewArtifactSchema = z.object(
  candidateDeepReviewArtifactShape,
)

export const candidateDeepReviewSubmissionSchema =
  pipelineLeaseSchema.extend(candidateDeepReviewArtifactShape)

export const candidateDeepReviewAgentArtifactSchema = z.object({
  decisions: z.array(z.object({
    candidate_index: z.number().int().min(0).max(19),
    ...candidateDeepReviewSubmissionDecisionShape
  })).min(1).max(20)
})

/**
 * Deep Review is allowed to repair a candidate's operational fields, but it
 * never owns source identity or evidence.  Luna occasionally echoes the
 * leased provenance object despite the output contract explicitly prohibiting
 * it.  Do not let an invalid echoed content hash discard an otherwise useful
 * review batch: remove it before validation and restore the authoritative
 * provenance from the leased row in applyDeepReviewRepair().
 */
export function stripUntrustedDeepReviewProvenance(
  unparsedArtifact: unknown,
): unknown {
  if (
    !unparsedArtifact ||
    typeof unparsedArtifact !== 'object' ||
    Array.isArray(unparsedArtifact)
  ) {
    return unparsedArtifact
  }
  const artifact = unparsedArtifact as Record<string, unknown>
  if (!Array.isArray(artifact['decisions'])) return unparsedArtifact
  return {
    ...artifact,
    decisions: artifact['decisions'].map((unparsedDecision) => {
      if (
        !unparsedDecision ||
        typeof unparsedDecision !== 'object' ||
        Array.isArray(unparsedDecision)
      ) {
        return unparsedDecision
      }
      const decision = unparsedDecision as Record<string, unknown>
      const repaired = decision['repaired_candidate']
      if (!repaired || typeof repaired !== 'object' || Array.isArray(repaired)) {
        return decision
      }
      const repair = repaired as Record<string, unknown>
      const changes = repair['changes']
      if (!changes || typeof changes !== 'object' || Array.isArray(changes)) {
        return decision
      }
      const { provenance: _untrustedProvenance, ...safeChanges } =
        changes as Record<string, unknown>
      return {
        ...decision,
        repaired_candidate: {
          ...repair,
          changes: safeChanges
        }
      }
    })
  }
}

export function materializeCandidateDeepReviewArtifact(
  unparsedArtifact: unknown,
  candidateIds: string[],
): z.infer<typeof candidateDeepReviewArtifactSchema> {
  const artifact = candidateDeepReviewAgentArtifactSchema.parse(
    stripUntrustedDeepReviewProvenance(unparsedArtifact),
  )
  const indexes = new Set(
    artifact.decisions.map((decision) => decision.candidate_index),
  )
  if (
    indexes.size !== artifact.decisions.length ||
    [...indexes].some((index) => index >= candidateIds.length)
  ) {
    throw new Error(
      'Deep-review candidate indexes must be unique and leased.',
    )
  }
  return candidateDeepReviewArtifactSchema.parse({
    decisions: artifact.decisions.map((decision) => {
      const { candidate_index: candidateIndex, ...result } = decision
      return {
        candidate_id: candidateIds[candidateIndex],
        ...result
      }
    })
  })
}

export function applyDeepReviewRepair(
  originalCandidate: unknown,
  repairedCandidate: unknown,
): z.infer<typeof pipelineCandidatePayloadSchema> {
  const original = pipelineCandidatePayloadSchema.parse(originalCandidate)
  // Structured-output wires encode optional patch fields as explicit null.
  // Normalize here too, rather than relying on the coordinator, so every
  // server-side caller has identical no-op semantics for null.
  const repair = candidateDeepReviewRepairPatchSchema.parse(
    omitNullObjectProperties(repairedCandidate),
  )
  const changes = Object.fromEntries(
    Object.entries(repair.changes).filter(([, value]) => value !== null),
  )
  const repaired = {
    ...original,
    ...changes
  } as Record<string, unknown>
  for (const field of repair.clear) delete repaired[field]
  return enforceKnowledgeRisk(
    pipelineCandidatePayloadSchema.parse({
      ...repaired,
      provenance: original.provenance
    }),
  )
}

export function materializeCandidateVerificationArtifact(
  unparsedArtifact: unknown,
  candidateIds: string[],
): z.infer<typeof candidateVerificationArtifactSchema> {
  const artifact = candidateVerificationAgentArtifactSchema.parse(
    unparsedArtifact,
  )
  const indexes = new Set(
    artifact.decisions.map((decision) => decision.candidate_index),
  )
  if (
    indexes.size !== artifact.decisions.length ||
    [...indexes].some((index) => index >= candidateIds.length)
  ) {
    throw new Error(
      'Verification artifact candidate indexes must be unique and leased.',
    )
  }
  return candidateVerificationArtifactSchema.parse({
    decisions: artifact.decisions.map((decision) => {
      const {
        candidate_index: candidateIndex,
        ...result
      } = decision
      return {
        candidate_id: candidateIds[candidateIndex],
        ...result
      }
    })
  })
}

export const expertResearchArtifactSchema = z.union([
  pipelineCandidatePayloadSchema,
  z.object({
    rejected: z.literal(true),
    reason: z.string().trim().min(12).max(1_000)
  })
])

export const expertResearchStructuredArtifactSchema = z.object({
  outcome: z.enum(['candidate', 'rejected']),
  candidate: pipelineCandidatePayloadSchema.nullable(),
  reason: z.string().trim().min(12).max(1_000).nullable()
}).superRefine((value, context) => {
  if (value.outcome === 'candidate' && !value.candidate) {
    context.addIssue({
      code: 'custom',
      path: ['candidate'],
      message: 'A candidate outcome requires a candidate.'
    })
  }
  if (value.outcome === 'rejected' && !value.reason) {
    context.addIssue({
      code: 'custom',
      path: ['reason'],
      message: 'A rejected outcome requires a reason.'
    })
  }
})

export const pipelineFailureSchema = pipelineLeaseSchema.extend({
  failure_code: z.string().regex(/^[A-Z][A-Z0-9_]{2,63}$/),
  failure_message: z.string().trim().min(8).max(1_000)
})

export const agentRunResultSchema = z.object({
  agent_run_id: z.string().uuid(),
  status: z.enum(['completed', 'failed', 'timed_out', 'cancelled']),
  input_tokens: z.number().int().min(0),
  cached_input_tokens: z.number().int().min(0).default(0),
  output_tokens: z.number().int().min(0),
  reasoning_output_tokens: z.number().int().min(0).default(0),
  duration_ms: z.number().int().min(0),
  error_code: z.string().regex(/^[A-Z][A-Z0-9_]{2,63}$/).optional(),
  process_exit_code: z.number().int().min(-1).max(255).optional(),
  diagnostic_code: z.string()
    .regex(/^[A-Z][A-Z0-9_]{2,63}$/).optional(),
  diagnostic_fingerprint: z.string()
    .regex(/^sha256:[0-9a-f]{64}$/).optional()
})

export const pipelineSystemFailureSchema = z.object({
  failure_code: z.literal('COORDINATOR_REPEATED_FAILURE'),
  failure_message: z.string().trim().min(8).max(1_000)
})

export type PipelineTaskRow = {
  id: string
  task_type:
    | 'expert_research'
    | 'source_discovery'
    | 'source_acquisition'
    | 'source_conversion'
    | 'source_chunking'
    | 'fragment_analysis'
    | 'candidate_verification'
    | 'candidate_deep_review'
    | 'candidate_publication'
    | 'source_publication'
    | 'source_refresh'
  stage:
    | 'discover'
    | 'acquire'
    | 'convert'
    | 'chunk'
    | 'analyze'
    | 'verify'
    | 'deep_review'
    | 'publish'
  payload: Record<string, unknown>
  coverage_target_id: string | null
  source_candidate_id: string | null
  expert_task_id: string | null
  knowledge_demand_id: string | null
  requested_reasoning_effort?: 'low' | 'medium'
  attempts?: number
}

type LeasedKnowledgeDemand = {
  question: string
  tool_name: string
  context: Record<string, unknown>
  excluded_source_urls: string[]
}

/**
 * A demand question is already available to discovery, but source-derived AI
 * tasks are intentionally stored without it. Add it only to the short-lived
 * leased payload so extraction and review can preserve the exact requested
 * technical terms without duplicating user input in every task row.
 */
export function withLeasedKnowledgeDemand(
  payload: Record<string, unknown>,
  demand: LeasedKnowledgeDemand,
): Record<string, unknown> {
  return {
    ...payload,
    knowledge_demand: {
      question: demand.question,
      tool_name: demand.tool_name,
      context: demand.context,
      excluded_source_urls: demand.excluded_source_urls,
    },
  }
}

const aiTaskTypes: PipelineTaskRow['task_type'][] = [
  'expert_research',
  'source_discovery',
  'fragment_analysis',
  'candidate_verification',
  'candidate_deep_review',
  'source_refresh'
]

const mechanicalTaskTypes: PipelineTaskRow['task_type'][] = [
  'source_acquisition',
  'source_conversion',
  'source_chunking',
  'candidate_publication',
  'source_publication'
]

const nonBlockingAiTaskTypes: PipelineTaskRow['task_type'][] = [
  'fragment_analysis',
  'candidate_verification',
  'candidate_deep_review'
]

const sourceReplacementTaskTypes: PipelineTaskRow['task_type'][] = [
  'source_discovery',
  'source_refresh',
  'source_acquisition',
  'source_conversion',
  'source_chunking'
]

/**
 * An unanswered MCP request is a durable learning goal, not a one-shot AI
 * task.  A technical or structural failure in a source-derived AI pass must
 * leave that goal in processing while the candidate is automatically retried.
 * A terminal source failure instead immediately permits a fresh official
 * discovery attempt, never a 15-minute dead end.
 */
export function demandFailureDisposition(input: {
  hasDemand: boolean
  taskType: PipelineTaskRow['task_type']
  retrying: boolean
}): 'normal' | 'keep_processing' | 'restart_discovery' {
  if (!input.hasDemand) return 'normal'
  if (nonBlockingAiTaskTypes.includes(input.taskType)) {
    return 'keep_processing'
  }
  if (!input.retrying && sourceReplacementTaskTypes.includes(input.taskType)) {
    return 'restart_discovery'
  }
  return 'normal'
}

const requiredPipelineModel = 'gpt-5.6-luna'
const requiredPipelineReasoning = 'low'
const aiPriorities = {
  expert: 100,
  deepMedium: 96,
  // A platform fallback remains downstream of Verify/Analyze, but normal
  // Medium review always has the first chance to run.  The fallback is only
  // eligible after that exact Medium work has exhausted technical retries.
  deepMediumFallback: 95,
  deepLow: 92,
  verify: 88,
  analyze: 80,
  discover: 50
} as const
const mediumPlatformFallbackRetryThreshold = 4
const maxFragmentAnalysisBatchBytes = 65_536
const maxFragmentAnalysisBatchSize = 16

export function boundFragmentAnalysisBatch<
  T extends { content: string }
>(
  fragments: T[],
  maxBytes = maxFragmentAnalysisBatchBytes,
): T[] {
  const selected: T[] = []
  let selectedBytes = 0
  for (const fragment of fragments) {
    if (selected.length >= maxFragmentAnalysisBatchSize) break
    const fragmentBytes = Buffer.byteLength(fragment.content, 'utf8')
    if (
      selected.length > 0 &&
      selectedBytes + fragmentBytes > maxBytes
    ) {
      break
    }
    selected.push(fragment)
    selectedBytes += fragmentBytes
  }
  return selected
}

export function automaticUnresolvedDisposition(input: {
  reviewPass: 'low' | 'medium'
  dangerous: boolean
  confidence: number
  todayManualExceptions: number
  manualExceptionDailyCap: number
}): 'deep_review' | 'rejected' {
  if (input.reviewPass === 'low') return 'deep_review'
  return 'rejected'
}

/**
 * A smaller Deep Review batch is a quality recovery mechanism, not a generic
 * retry penalty.  An omitted candidate or malformed structured artifact can
 * be caused by an over-large response; a transient Codex/platform failure
 * cannot.  Shrinking for the latter silently turns healthy 10–20-record work
 * into expensive one-record runs without improving the next attempt.
 */
export function shouldReduceDeepReviewBatchOnFailure(
  failureCode: string,
  failureMessage: string,
): boolean {
  if (failureCode !== 'AGENT_ARTIFACT_REJECTED') return false
  return !(
    /\bINTERNAL_ERROR\b|retry later with the same safe inputs/i
      .test(failureMessage) ||
    /repaired_candidate\.provenance(?:\.\d+)?\.content_hash/i
      .test(failureMessage)
  )
}

/**
 * Batch shrinking is only useful when an artifact actually proves the current
 * response is too large. Once a complete, schema-valid pass succeeds at the
 * current size, recover capacity gradually. This prevents an old omitted
 * candidate from pinning an entire source cohort to one-record Luna runs.
 */
export function nextDeepReviewBatchLimitAfterCleanPass(
  currentBatchLimit: number,
  handledRecords: number,
): number {
  const current = Math.min(20, Math.max(1, Math.trunc(currentBatchLimit)))
  if (Math.trunc(handledRecords) < current) return current
  return Math.min(20, current * 2)
}

/**
 * The Codex CLI may exit successfully while emitting a structured
 * `INTERNAL_ERROR` instead of the requested artifact.  This is a temporary
 * platform failure, not a malformed knowledge record; it must use the same
 * circuit-breaker path as a failed Codex process.
 */
export function isRetryableCodexPlatformArtifactFailure(
  failureMessage: string,
): boolean {
  return /\bINTERNAL_ERROR\b[\s\S]{0,240}\b(?:request could not be completed|retry later)\b/i
    .test(failureMessage)
}

/**
 * Slow retries only for a repeating, fingerprinted platform incident. A
 * one-off process failure remains retryable immediately; repeated identical
 * failures increasingly protect the token budget until a single probe proves
 * the platform has recovered.
 */
export function codexCircuitCooldownSeconds(
  matchingFailures: number,
): number {
  if (matchingFailures < 4) return 0
  const escalation = Math.floor((matchingFailures - 4) / 4)
  return Math.min(300, 30 * (2 ** escalation))
}

type AiCircuitRow = {
  task_type: PipelineTaskRow['task_type']
  reasoning_effort: 'low' | 'medium'
  open_until: string | Date
  probe_executor_id: string | null
}

function isAiTaskType(
  taskType: PipelineTaskRow['task_type'],
): boolean {
  return aiTaskTypes.includes(taskType)
}

async function recordEvent(
  client: DatabaseClient,
  input: {
    taskId?: string | null
    sourceId?: string | null
    stage:
      | PipelineTaskRow['stage']
      | 'system'
    event:
      | 'queued'
      | 'claimed'
      | 'started'
      | 'progress'
      | 'completed'
      | 'failed'
      | 'retried'
      | 'paused'
      | 'resumed'
      | 'skipped'
    message: string
    metadata?: Record<string, unknown>
  },
): Promise<void> {
  await client.query(
    `INSERT INTO pipeline_events (
       pipeline_task_id,
       source_candidate_id,
       stage,
       event_type,
       message,
       metadata
     )
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
    [
      input.taskId ?? null,
      input.sourceId ?? null,
      input.stage,
      input.event,
      input.message,
      JSON.stringify(input.metadata ?? {})
    ],
  )
}

async function recordExecutorHeartbeat(
  client: DatabaseClient,
  executorId: string,
  instanceId: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  await client.query(
    `INSERT INTO worker_heartbeats (
       worker_name, instance_id, heartbeat_at, metadata
     )
     VALUES ($1, $2, now(), $3::jsonb)
     ON CONFLICT (worker_name)
     DO UPDATE SET
       instance_id = excluded.instance_id,
       heartbeat_at = excluded.heartbeat_at,
       metadata = excluded.metadata`,
    [executorId, instanceId, JSON.stringify(metadata)],
  )
}

async function insertTask(
  client: DatabaseClient,
  input: {
    type: PipelineTaskRow['task_type']
    stage: PipelineTaskRow['stage']
    priority: number
    dedupeKey: string
    coverageTargetId?: string | null
    sourceId?: string | null
    expertTaskId?: string | null
    knowledgeDemandId?: string | null
    payload?: Record<string, unknown>
    reasoningEffort?: 'low' | 'medium'
  },
): Promise<string | null> {
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO pipeline_tasks (
       task_type,
       stage,
       priority,
       coverage_target_id,
       source_candidate_id,
       expert_task_id,
       knowledge_demand_id,
       dedupe_key,
       payload,
       requested_reasoning_effort
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)
     ON CONFLICT (dedupe_key)
       WHERE status IN ('queued', 'claimed', 'running')
     DO NOTHING
     RETURNING id`,
    [
      input.type,
      input.stage,
      input.priority,
      input.coverageTargetId ?? null,
      input.sourceId ?? null,
      input.expertTaskId ?? null,
      input.knowledgeDemandId ?? null,
      input.dedupeKey,
      JSON.stringify(input.payload ?? {}),
      input.reasoningEffort ?? 'low'
    ],
  )
  const taskId = inserted.rows[0]?.id ?? null
  if (taskId) {
    await recordEvent(client, {
      taskId,
      sourceId: input.sourceId ?? null,
      stage: input.stage,
      event: 'queued',
      message: `Queued ${input.type.replaceAll('_', ' ')} work.`
    })
  }
  return taskId
}

async function reconcileExpiredAndCompletedWork(
  client: DatabaseClient,
): Promise<void> {
  const expired = await client.query<{
    id: string
    task_type: PipelineTaskRow['task_type']
    stage: PipelineTaskRow['stage']
    source_candidate_id: string | null
    expert_task_id: string | null
    payload: Record<string, unknown>
    attempts: number
    status: string
  }>(
    `UPDATE pipeline_tasks
        SET status = CASE WHEN attempts >= 5 THEN 'failed' ELSE 'queued' END,
            claim_owner = NULL,
            lease_token_hash = NULL,
            lease_until = NULL,
            heartbeat_at = NULL,
            failure_code = CASE
              WHEN attempts >= 5 THEN 'LEASE_ATTEMPTS_EXHAUSTED'
              ELSE NULL
            END,
            failure_message = CASE
              WHEN attempts >= 5 THEN 'Pipeline task lease expired too many times.'
              ELSE NULL
            END,
            completed_at = CASE WHEN attempts >= 5 THEN now() ELSE NULL END,
            updated_at = now()
      WHERE status IN ('claimed', 'running')
        AND lease_until <= now()
      RETURNING
        id,
        task_type,
        stage,
        source_candidate_id,
        expert_task_id,
        payload,
        attempts,
        status`,
  )
  for (const task of expired.rows) {
    const exhausted = task.status === 'failed'
    await client.query(
      `UPDATE agent_runs
          SET status = 'failed',
              error_code = 'LEASE_EXPIRED',
              completed_at = now()
        WHERE pipeline_task_id = $1
          AND status = 'running'`,
      [task.id],
    )
    if (task.task_type === 'fragment_analysis') {
      await client.query(
        `UPDATE source_fragments
            SET status = CASE WHEN $2 THEN 'failed' ELSE 'reserved' END,
                reservation_task_id = CASE WHEN $2 THEN NULL ELSE $1 END,
                updated_at = now()
          WHERE reservation_task_id = $1
            AND status IN ('reserved', 'analyzing')`,
        [task.id, exhausted],
      )
    }
    if (task.task_type === 'candidate_verification' && exhausted) {
      await client.query(
        `UPDATE knowledge_candidates
            SET status = 'deep_review',
                verification_task_id = NULL,
                resolution_code = 'verification_lease_exhausted',
                resolution_reason = 'Standard verification lease attempts were exhausted.',
                next_review_at = now(),
                updated_at = now()
          WHERE verification_task_id = $1
            AND status = 'analyzed'`,
        [task.id],
      )
    }
    if (task.task_type === 'candidate_deep_review') {
      await client.query(
        `UPDATE knowledge_candidates
            SET deep_review_task_id = CASE WHEN $2 THEN NULL ELSE $1 END,
                status = 'deep_review',
                next_review_at = now(),
                resolution_reason = CASE
                  WHEN $2 THEN 'Deep-review lease attempts were exhausted; candidate remains automatically retryable.'
                  ELSE resolution_reason
                END,
                resolution_code = CASE
                  WHEN $2 THEN 'deep_lease_exhausted'
                  ELSE resolution_code
                END,
                deep_review_batch_limit = CASE
                  WHEN $2 THEN greatest(1, deep_review_batch_limit / 2)
                  ELSE deep_review_batch_limit
                END,
                technical_retry_count = CASE
                  WHEN $2 THEN least(20, technical_retry_count + 1)
                  ELSE technical_retry_count
                END,
                last_technical_failure_code = CASE
                  WHEN $2 THEN 'deep_lease_exhausted'
                  ELSE last_technical_failure_code
                END,
                updated_at = now()
          WHERE deep_review_task_id = $1
            AND status = 'deep_review'`,
        [task.id, exhausted],
      )
    }
    if (task.task_type === 'candidate_publication' && exhausted) {
      await client.query(
        `UPDATE knowledge_candidates
            SET publication_task_id = NULL,
                updated_at = now()
          WHERE publication_task_id = $1
            AND status = 'verified'`,
        [task.id],
      )
    }
    if (task.expert_task_id) {
      await client.query(
        `UPDATE expert_tasks
            SET status = CASE WHEN $2 THEN 'failed' ELSE 'queued' END,
                claim_owner = NULL,
                lease_token_hash = NULL,
                lease_until = NULL,
                heartbeat_at = NULL,
                failure_code = CASE
                  WHEN $2 THEN 'LEASE_ATTEMPTS_EXHAUSTED'
                  ELSE NULL
                END,
                failure_message = CASE
                  WHEN $2 THEN 'Expert task lease expired too many times.'
                  ELSE NULL
                END,
                completed_at = CASE WHEN $2 THEN now() ELSE NULL END,
                updated_at = now()
          WHERE id = $1
            AND status IN ('claimed', 'researching')`,
        [task.expert_task_id, exhausted],
      )
    }
    await recordEvent(client, {
      taskId: task.id,
      sourceId: task.source_candidate_id,
      stage: task.stage,
      event: exhausted ? 'failed' : 'retried',
      message:
        exhausted
          ? 'Pipeline lease attempts were exhausted.'
          : 'Expired pipeline lease returned to the queue.'
    })
  }

  await client.query(
    `UPDATE agent_runs run
        SET status = 'failed',
            error_code = 'ORPHANED_AGENT_RUN',
            completed_at = now()
      WHERE run.status = 'running'
        AND run.started_at < now() - interval '15 minutes'
        AND NOT EXISTS (
          SELECT 1
          FROM pipeline_tasks task
          WHERE task.id = run.pipeline_task_id
            AND task.status IN ('claimed', 'running')
        )`,
  )

  await client.query(
    `UPDATE pipeline_tasks pt
        SET status = CASE
              WHEN et.status = 'completed' THEN 'completed'
              ELSE 'failed'
            END,
            result = jsonb_build_object(
              'expert_task_status', et.status,
              'revision_id', et.result_revision_id
            ),
            failure_code = et.failure_code,
            failure_message = et.failure_message,
            completed_at = coalesce(et.completed_at, now()),
            updated_at = now()
       FROM expert_tasks et
      WHERE pt.expert_task_id = et.id
        AND pt.task_type = 'expert_research'
        AND pt.status IN ('queued', 'claimed', 'running')
        AND et.status IN ('completed', 'failed', 'cancelled', 'expired')`,
  )
}

async function queueExpertWork(client: DatabaseClient): Promise<boolean> {
  const expert = await client.query<{
    id: string
    public_id: string
    question: string
    network_context: Record<string, unknown>
  }>(
    `SELECT id, public_id, question, network_context
       FROM expert_tasks
      WHERE status = 'queued'
        AND NOT EXISTS (
          SELECT 1
          FROM pipeline_tasks pt
          WHERE pt.expert_task_id = expert_tasks.id
            AND pt.status IN ('queued', 'claimed', 'running')
        )
      ORDER BY priority DESC, created_at
      LIMIT 1
      FOR UPDATE SKIP LOCKED`,
  )
  const task = expert.rows[0]
  if (!task) return false
  const id = await insertTask(client, {
    type: 'expert_research',
    stage: 'analyze',
    priority: aiPriorities.expert,
    dedupeKey: `expert:${task.id}`,
    expertTaskId: task.id,
    payload: {
      task_id: task.public_id,
      question: task.question,
      network_context: task.network_context
    }
  })
  return Boolean(id)
}

type DeepReviewMode = 'low' | 'medium' | 'fallback_low'

function deepReviewModeFromTask(task: Pick<
  PipelineTaskRow,
  'requested_reasoning_effort' | 'payload'
>): DeepReviewMode {
  if (
    task.requested_reasoning_effort === 'low' &&
    task.payload['review_pass'] === 'fallback_low'
  ) {
    return 'fallback_low'
  }
  return task.requested_reasoning_effort === 'medium' ? 'medium' : 'low'
}

async function queueDeepReviewWork(
  client: DatabaseClient,
  reviewMode: DeepReviewMode,
): Promise<boolean> {
  const seed = await client.query<{
    id: string
    pipeline_task_id: string
    source_candidate_id: string | null
    knowledge_demand_id: string | null
    resolution_attempts: number
    resolution_reason: string | null
    resolution_code: string | null
    deep_review_batch_limit: number
  }>(
    `SELECT
       kc.id,
       kc.pipeline_task_id,
       pt.source_candidate_id,
       source.knowledge_demand_id,
       kc.resolution_attempts,
       kc.resolution_reason,
       kc.resolution_code,
       kc.deep_review_batch_limit
     FROM knowledge_candidates kc
     JOIN pipeline_tasks pt ON pt.id = kc.pipeline_task_id
     LEFT JOIN source_candidates source
       ON source.id = pt.source_candidate_id
     WHERE kc.status IN ('deep_review', 'quarantined')
       AND kc.deep_review_task_id IS NULL
       AND (
         kc.status = 'deep_review'
         OR kc.next_review_at IS NULL
         OR kc.next_review_at <= now()
       )
       AND (
         ($1 = 'low' AND kc.resolution_attempts = 0)
         OR (
           $1 = 'medium'
           AND kc.resolution_attempts > 0
           AND NOT (
             kc.technical_retry_count >= $2
             AND kc.last_technical_failure_code = 'CODEX_PROCESS_FAILED'
           )
         )
         OR (
           $1 = 'fallback_low'
           AND kc.resolution_attempts > 0
           AND kc.technical_retry_count >= $2
           AND kc.last_technical_failure_code = 'CODEX_PROCESS_FAILED'
         )
       )
     ORDER BY
       CASE WHEN source.knowledge_demand_id IS NOT NULL THEN 0 ELSE 1 END,
       CASE WHEN kc.status = 'deep_review' THEN 0 ELSE 1 END,
       kc.next_review_at NULLS FIRST,
       kc.created_at
     LIMIT 1
     FOR UPDATE OF kc SKIP LOCKED`,
    [reviewMode, mediumPlatformFallbackRetryThreshold],
  )
  const first = seed.rows[0]
  if (!first) return false

  const batch = await client.query<{
    id: string
    stable_key: string
    payload: Record<string, unknown>
    dangerous: boolean
    confidence: string
    quality_score: string
    resolution_attempts: number
    resolution_reason: string | null
    resolution_code: string | null
  }>(
    `SELECT
       kc.id,
       kc.stable_key,
       kc.payload,
       kc.dangerous,
       kc.confidence,
       kc.quality_score,
       kc.resolution_attempts,
       kc.resolution_reason,
       kc.resolution_code
     FROM knowledge_candidates kc
     JOIN pipeline_tasks pt ON pt.id = kc.pipeline_task_id
     WHERE kc.status IN ('deep_review', 'quarantined')
       AND kc.deep_review_task_id IS NULL
       AND pt.source_candidate_id IS NOT DISTINCT FROM $1::uuid
       AND (
         ($2 = 'low' AND kc.resolution_attempts = 0)
         OR (
           $2 = 'medium'
           AND kc.resolution_attempts > 0
           AND NOT (
             kc.technical_retry_count >= $6
             AND kc.last_technical_failure_code = 'CODEX_PROCESS_FAILED'
           )
         )
         OR (
           $2 = 'fallback_low'
           AND kc.resolution_attempts > 0
           AND kc.technical_retry_count >= $6
           AND kc.last_technical_failure_code = 'CODEX_PROCESS_FAILED'
         )
       )
       AND (
         kc.status = 'deep_review'
         OR kc.next_review_at IS NULL
         OR kc.next_review_at <= now()
       )
       AND coalesce(kc.resolution_code, 'unspecified') =
           coalesce($3::text, 'unspecified')
       AND kc.deep_review_batch_limit = $5
     ORDER BY kc.created_at
     LIMIT $4
     FOR UPDATE OF kc SKIP LOCKED`,
    [
      first.source_candidate_id,
      reviewMode,
      first.resolution_code,
      first.deep_review_batch_limit,
      first.deep_review_batch_limit,
      mediumPlatformFallbackRetryThreshold
    ],
  )
  if (batch.rows.length === 0) return false
  const candidateIds = batch.rows.map((candidate) => candidate.id)
  const taskId = await insertTask(client, {
    type: 'candidate_deep_review',
    stage: 'deep_review',
    priority: reviewMode === 'medium'
      ? (first.knowledge_demand_id ? 120 : aiPriorities.deepMedium)
      : reviewMode === 'fallback_low'
        ? (first.knowledge_demand_id
          ? 120
          : aiPriorities.deepMediumFallback)
        : (first.knowledge_demand_id ? 120 : aiPriorities.deepLow),
    dedupeKey: `deep-review:${reviewMode}:${sha256Label(
      candidateIds.join(','),
    )}`,
    sourceId: first.source_candidate_id,
    knowledgeDemandId: first.knowledge_demand_id,
    payload: {
      review_pass: reviewMode,
      ...(reviewMode === 'fallback_low'
        ? {
            force_terminal_resolution: true,
            fallback_reason: 'deep_medium_platform_retry_exhausted'
          }
        : {}),
      batch_limit: first.deep_review_batch_limit,
      resolution_code: first.resolution_code,
      candidates: batch.rows
    },
    reasoningEffort: reviewMode === 'medium' ? 'medium' : 'low'
  })
  if (!taskId) return false
  await client.query(
    `UPDATE knowledge_candidates
        SET status = 'deep_review',
            deep_review_task_id = $1,
            updated_at = now()
      WHERE id = ANY($2::uuid[])
        AND deep_review_task_id IS NULL`,
    [taskId, candidateIds],
  )
  return true
}

async function queueSourceWork(
  client: DatabaseClient,
  sourceId: string,
  mode: 'mechanical' | 'ai' | 'verification' | 'analysis',
): Promise<boolean> {
  const sourceResult = await client.query<{
    id: string
    status: string
    coverage_target_id: string
    vendor_slug: string
    product_family: string | null
    model: string | null
    operating_system_slug: string
    version_branch: string | null
    document_role: string
    canonical_url: string
    document_type: string
    title: string
    document_version: string | null
    document_date: string | null
    knowledge_demand_id: string | null
    demand_question: string | null
  }>(
    `SELECT
       sc.id,
       sc.status,
       sc.coverage_target_id,
       ct.vendor_slug,
       ct.product_family,
       ct.model,
       ct.operating_system_slug,
       ct.version_branch,
       ct.document_role,
       sc.canonical_url,
       sc.document_type,
       sc.title,
       sc.document_version,
       sc.document_date,
       sc.knowledge_demand_id,
       demand.question AS demand_question
     FROM source_candidates sc
     JOIN coverage_targets ct ON ct.id = sc.coverage_target_id
     LEFT JOIN knowledge_demands demand ON demand.id = sc.knowledge_demand_id
     WHERE sc.id = $1
     FOR UPDATE OF sc`,
    [sourceId],
  )
  const source = sourceResult.rows[0]
  if (!source) {
    await client.query(
      `DELETE FROM active_source_slots
       WHERE source_candidate_id = $1`,
      [sourceId],
    )
    await client.query(
      `UPDATE pipeline_settings
          SET active_source_id = NULL,
              updated_at = now()
        WHERE singleton`,
    )
    return false
  }

  if ([
    'completed',
    'completed_with_exceptions',
    'duplicate',
    'rejected'
  ].includes(source.status)) {
    await client.query(
      `DELETE FROM active_source_slots
       WHERE source_candidate_id = $1`,
      [source.id],
    )
    await client.query(
      `UPDATE pipeline_settings
          SET active_source_id = NULL,
              updated_at = now(),
              updated_by = 'scheduler-terminal-source'
        WHERE singleton AND active_source_id = $1`,
      [source.id],
    )
    return false
  }

  const basePayload = {
    source_id: source.id,
    canonical_url: source.canonical_url,
    document_type: source.document_type,
    title: source.title,
    document_version: source.document_version,
    document_date: source.document_date
      ? new Date(source.document_date).toISOString().slice(0, 10)
      : null,
    coverage_target: {
      vendor_slug: source.vendor_slug,
      product_family: source.product_family,
      model: source.model,
      operating_system_slug: source.operating_system_slug,
      version_branch: source.version_branch,
      document_role: source.document_role
    }
  }
  const taskPriority = source.knowledge_demand_id ? 120 : null
  if (source.knowledge_demand_id) {
    await client.query(
      `UPDATE knowledge_demands
          SET status = CASE
                WHEN $2 = ANY($3::text[]) THEN 'acquiring'
                ELSE 'processing'
              END,
              source_candidate_id = coalesce(source_candidate_id, $4),
              last_seen_at = now()
        WHERE id = $1
          AND status <> 'published'`,
      [
        source.knowledge_demand_id,
        source.status,
        ['discovered', 'approved', 'acquiring'],
        source.id
      ],
    )
  }

  if (['discovered', 'approved', 'acquiring'].includes(source.status)) {
    if (mode !== 'mechanical') return false
    return Boolean(await insertTask(client, {
      type: 'source_acquisition',
      stage: 'acquire',
      priority: taskPriority ?? 80,
      dedupeKey: `source:${source.id}:acquire`,
      coverageTargetId: source.coverage_target_id,
      sourceId: source.id,
      knowledgeDemandId: source.knowledge_demand_id,
      payload: basePayload
    }))
  }
  if (['acquired', 'converting'].includes(source.status)) {
    if (mode !== 'mechanical') return false
    return Boolean(await insertTask(client, {
      type: 'source_conversion',
      stage: 'convert',
      priority: taskPriority ?? 78,
      dedupeKey: `source:${source.id}:convert`,
      coverageTargetId: source.coverage_target_id,
      sourceId: source.id,
      knowledgeDemandId: source.knowledge_demand_id,
      payload: basePayload
    }))
  }
  if (['converted', 'chunking'].includes(source.status)) {
    if (mode !== 'mechanical') return false
    return Boolean(await insertTask(client, {
      type: 'source_chunking',
      stage: 'chunk',
      priority: taskPriority ?? 76,
      dedupeKey: `source:${source.id}:chunk`,
      coverageTargetId: source.coverage_target_id,
      sourceId: source.id,
      knowledgeDemandId: source.knowledge_demand_id,
      payload: basePayload
    }))
  }

  if (
    mode === 'ai' ||
    mode === 'verification' ||
    mode === 'analysis'
  ) {
    if (mode === 'ai' || mode === 'verification') {
    const verificationReadiness = await client.query<{
      ready: boolean
    }>(
      `SELECT (
         count(*) >= 32
         OR bool_or(kc.created_at <= now() - interval '15 seconds')
         OR NOT EXISTS (
           SELECT 1
           FROM source_fragments sf
           JOIN source_artifacts sa ON sa.id = sf.source_artifact_id
           WHERE sa.source_candidate_id = $1
             AND sf.status IN ('queued', 'reserved', 'analyzing')
         )
       ) AS ready
       FROM knowledge_candidates kc
       JOIN pipeline_tasks pt ON pt.id = kc.pipeline_task_id
       WHERE pt.source_candidate_id = $1
         AND kc.status = 'analyzed'
         AND kc.verification_task_id IS NULL`,
      [source.id],
    )
    const analyzedCandidates = await client.query<{
      id: string
      stable_key: string
      payload: Record<string, unknown>
      dangerous: boolean
      confidence: string
      quality_score: string
    }>(
      `SELECT
         id,
         stable_key,
         payload,
         dangerous,
         confidence,
         quality_score
       FROM knowledge_candidates
       WHERE status = 'analyzed'
         AND verification_task_id IS NULL
         AND $2::boolean
         AND pipeline_task_id IN (
           SELECT id FROM pipeline_tasks WHERE source_candidate_id = $1
         )
       ORDER BY created_at
       LIMIT 50
       FOR UPDATE SKIP LOCKED`,
      [source.id, verificationReadiness.rows[0]?.ready ?? false],
    )
    if (analyzedCandidates.rows.length > 0) {
      const candidateIds = analyzedCandidates.rows.map((row) => row.id)
      const taskId = await insertTask(client, {
        type: 'candidate_verification',
        stage: 'verify',
        priority: taskPriority ?? aiPriorities.verify,
        dedupeKey: `source:${source.id}:verify:${sha256Label(
          candidateIds.join(','),
        )}`,
        coverageTargetId: source.coverage_target_id,
        sourceId: source.id,
        knowledgeDemandId: source.knowledge_demand_id,
        payload: {
          ...basePayload,
          candidates: analyzedCandidates.rows
        }
      })
      if (!taskId) return false
      await client.query(
        `UPDATE knowledge_candidates
            SET verification_task_id = $1,
                updated_at = now()
          WHERE id = ANY($2::uuid[])
            AND status = 'analyzed'
            AND verification_task_id IS NULL`,
        [taskId, candidateIds],
      )
      await client.query(
        `UPDATE source_candidates
            SET status = 'verifying',
                updated_at = now()
          WHERE id = $1`,
        [source.id],
      )
      return true
    }
    }
    if (mode === 'verification') return false

    const demandTermPatterns = source.demand_question
      ? knowledgeDemandTermPatterns(source.demand_question)
      : []
    const queuedFragments = await client.query<{
      id: string
      ordinal: number
      section_title: string | null
      source_locator: string | null
      content: string
      content_hash: string
    }>(
      `SELECT
         sf.id,
         sf.ordinal,
         sf.section_title,
         sf.source_locator,
         sf.content,
         sf.content_hash
       FROM source_fragments sf
       JOIN source_artifacts sa ON sa.id = sf.source_artifact_id
       WHERE sa.source_candidate_id = $1
         AND sf.status = 'queued'
         AND sf.reservation_task_id IS NULL
       ORDER BY
         COALESCE((
           SELECT sum(
             CASE
               WHEN coalesce(sf.section_title, '') ~* demand_pattern THEN 4
               ELSE 0
             END +
             CASE
               WHEN sf.content ~* demand_pattern THEN 1
               ELSE 0
             END
           )
           FROM unnest($2::text[]) AS terms(demand_pattern)
         ), 0) DESC,
         sf.ordinal
       LIMIT 16
       FOR UPDATE OF sf SKIP LOCKED`,
      [source.id, demandTermPatterns],
    )
    const analysisFragments = boundFragmentAnalysisBatch(
      queuedFragments.rows,
    )
    if (analysisFragments.length > 0) {
      const fragmentIds = analysisFragments.map((row) => row.id)
      const taskId = await insertTask(client, {
        type: 'fragment_analysis',
        stage: 'analyze',
        priority: taskPriority ?? aiPriorities.analyze,
        dedupeKey: `source:${source.id}:analyze:${sha256Label(
          fragmentIds.join(','),
        )}`,
        coverageTargetId: source.coverage_target_id,
        sourceId: source.id,
        knowledgeDemandId: source.knowledge_demand_id,
        payload: {
          ...basePayload,
          fragments: analysisFragments
        }
      })
      if (!taskId) return false
      await client.query(
        `UPDATE source_fragments
            SET status = 'reserved',
                reservation_task_id = $1,
                updated_at = now()
          WHERE id = ANY($2::uuid[])
            AND status = 'queued'
            AND reservation_task_id IS NULL`,
        [taskId, fragmentIds],
      )
      await client.query(
        `UPDATE source_candidates
            SET status = 'analyzing',
                updated_at = now()
          WHERE id = $1`,
        [source.id],
      )
      return true
    }
    return false
  }

  const outstanding = await client.query<{ count: number }>(
    `SELECT (
       (SELECT count(*) FROM source_fragments sf
        JOIN source_artifacts sa ON sa.id = sf.source_artifact_id
        WHERE sa.source_candidate_id = $1
          AND sf.status IN ('queued', 'reserved', 'analyzing'))
       +
       (SELECT count(*) FROM knowledge_candidates kc
        JOIN pipeline_tasks pt ON pt.id = kc.pipeline_task_id
        WHERE pt.source_candidate_id = $1
          AND (
            kc.status IN ('analyzed', 'deep_review')
            OR kc.verification_task_id IS NOT NULL
            OR kc.deep_review_task_id IS NOT NULL
          ))
       +
       (SELECT count(*) FROM pipeline_tasks active
        WHERE active.source_candidate_id = $1
          AND active.task_type IN (
            'fragment_analysis',
            'candidate_verification',
            'candidate_deep_review'
          )
          AND active.status IN ('queued', 'claimed', 'running'))
     )::int AS count`,
    [source.id],
  )
  if ((outstanding.rows[0]?.count ?? 0) === 0) {
    return Boolean(await insertTask(client, {
      type: 'source_publication',
      stage: 'publish',
      priority: taskPriority ?? 74,
      dedupeKey: `source:${source.id}:publish`,
      coverageTargetId: source.coverage_target_id,
      sourceId: source.id,
      knowledgeDemandId: source.knowledge_demand_id,
      payload: basePayload
    }))
  }
  return false
}

async function queueDiscoveryWork(client: DatabaseClient): Promise<boolean> {
  const activeDiscovery = await client.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1
       FROM pipeline_tasks
       WHERE task_type IN ('source_discovery', 'source_refresh')
         AND status IN ('queued', 'claimed', 'running')
     ) AS exists`,
  )
  if (activeDiscovery.rows[0]?.exists) return false

  // A fully covered catalog can have every target scheduled for a later
  // refresh. Requeue one target and select it in the same scheduler pass so a
  // drained source buffer never leaves a Luna lane empty for an extra cycle.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const targetResult = await client.query<{
      id: string
      vendor_slug: string
      product_family: string | null
      model: string | null
      operating_system_slug: string
      version_branch: string | null
      document_role: string
      priority: number
    }>(
      `SELECT
         id,
         vendor_slug,
         product_family,
         model,
         operating_system_slug,
         version_branch,
         document_role,
         priority
       FROM coverage_targets
       WHERE status <> 'paused'
         AND (
           status IN ('queued', 'failed')
           OR (
             status = 'covered'
             AND next_check_at <= now()
           )
         )
       ORDER BY priority DESC, next_check_at, updated_at
       LIMIT 1
       FOR UPDATE SKIP LOCKED`,
    )
    const target = targetResult.rows[0]
    if (target) {
      await client.query(
        `UPDATE coverage_targets
            SET status = 'discovering',
                last_discovered_at = now(),
                updated_at = now()
          WHERE id = $1`,
        [target.id],
      )
      return Boolean(await insertTask(client, {
        type: 'source_discovery',
        stage: 'discover',
        priority: Math.min(
          aiPriorities.discover,
          Math.max(1, target.priority),
        ),
        dedupeKey: `coverage:${target.id}:discover`,
        coverageTargetId: target.id,
        payload: {
          coverage_target: target,
          requirements: {
            public_https_only: true,
            official_vendor_sources_only: true,
            no_authenticated_sources: true,
            source_urls_are_internal: true
          }
        }
      }))
    }

    const requeued = await client.query<{ id: string }>(
      `UPDATE coverage_targets
          SET status = 'queued',
              next_check_at = now(),
              updated_at = now()
        WHERE id = (
          SELECT id
          FROM coverage_targets
          WHERE status = 'covered'
          ORDER BY next_check_at, priority DESC
          LIMIT 1
        )
        RETURNING id`,
    )
    if (!requeued.rows[0]) return false
  }
  return false
}

/**
 * Older versions could mark a demand failed after an AI lease exhausted even
 * though its candidate was already scheduled for another automatic Deep
 * Review.  Recover those durable learning goals without fabricating an answer
 * or creating a duplicate source-discovery task.
 */
async function reconcileTechnicalDemandFailures(
  client: DatabaseClient,
): Promise<void> {
  await client.query(
    `UPDATE knowledge_demands demand
        SET status = 'processing',
            next_retry_at = now(),
            last_seen_at = now()
      WHERE demand.status = 'failed'
        AND demand.last_error_code = ANY($1::text[])
        AND EXISTS (
          SELECT 1
          FROM source_candidates source
          JOIN pipeline_tasks origin
            ON origin.source_candidate_id = source.id
          JOIN knowledge_candidates candidate
            ON candidate.pipeline_task_id = origin.id
          WHERE source.knowledge_demand_id = demand.id
            AND candidate.status IN ('analyzed', 'deep_review')
        )`,
    [[
      'CODEX_PROCESS_FAILED',
      'AGENT_LAUNCH_FAILED',
      'AGENT_RUN_TIMEOUT',
      'LEASE_EXPIRED',
      'LEASE_ATTEMPTS_EXHAUSTED',
      'EMPTY_AGENT_RUN',
      'AGENT_ARTIFACT_REJECTED',
      'AGENT_REPORTING_FAILED'
    ]],
  )
}

async function queueDemandDiscoveryWork(
  client: DatabaseClient,
): Promise<boolean> {
  const demand = await client.query<{
    id: string
    question: string
    tool_name: string
    context: Record<string, unknown>
    coverage_target_id: string
    vendor_slug: string
    product_family: string | null
    model: string | null
    operating_system_slug: string
    version_branch: string | null
    document_role: string
    priority: number
  }>(
    `SELECT
       demand.id,
       demand.question,
       demand.tool_name,
       demand.context,
       demand.coverage_target_id,
       target.vendor_slug,
       target.product_family,
       target.model,
       target.operating_system_slug,
       target.version_branch,
       target.document_role,
       target.priority
     FROM knowledge_demands demand
     JOIN coverage_targets target
       ON target.id = demand.coverage_target_id
     WHERE demand.status IN ('queued', 'unresolved', 'failed')
       AND demand.next_retry_at <= now()
       AND NOT EXISTS (
         SELECT 1
         FROM pipeline_tasks active
         WHERE active.knowledge_demand_id = demand.id
           AND active.status IN ('queued', 'claimed', 'running')
       )
     ORDER BY demand.priority DESC, demand.first_seen_at
     LIMIT 1
     FOR UPDATE OF demand SKIP LOCKED`,
  )
  const row = demand.rows[0]
  if (!row) return false
  const taskId = await insertTask(client, {
    type: 'source_discovery',
    stage: 'discover',
    priority: 120,
    dedupeKey: `demand:${row.id}:discover`,
    coverageTargetId: row.coverage_target_id,
    knowledgeDemandId: row.id,
    payload: {
      coverage_target: {
        id: row.coverage_target_id,
        vendor_slug: row.vendor_slug,
        product_family: row.product_family,
        model: row.model,
        operating_system_slug: row.operating_system_slug,
        version_branch: row.version_branch,
        document_role: row.document_role,
        priority: row.priority
      },
      knowledge_demand: {
        question: row.question,
        tool_name: row.tool_name,
        context: row.context
      },
      requirements: {
        public_https_only: true,
        official_vendor_sources_only: true,
        no_authenticated_sources: true,
        source_urls_are_internal: true
      }
    }
  })
  if (!taskId) return false
  await client.query(
    `UPDATE knowledge_demands
        SET status = 'discovering',
            discovery_task_id = $2,
            last_error_code = NULL,
            last_seen_at = now()
      WHERE id = $1`,
    [row.id, taskId],
  )
  return true
}

async function queueCandidatePublication(
  client: DatabaseClient,
): Promise<boolean> {
  const readiness = await client.query<{
    count: number
    oldest_waiting_at: string | Date | null
  }>(
    `SELECT
       count(*)::int AS count,
       min(updated_at) AS oldest_waiting_at
     FROM knowledge_candidates
     WHERE status = 'verified'
       AND publication_task_id IS NULL`,
  )
  const count = readiness.rows[0]?.count ?? 0
  const oldest = readiness.rows[0]?.oldest_waiting_at
  if (
    count === 0 ||
    (
      count < 50 &&
      (
        !oldest ||
        new Date(oldest).getTime() > Date.now() - 30_000
      )
    )
  ) {
    return false
  }

  const batch = await client.query<{
    id: string
    pipeline_task_id: string
    source_candidate_id: string | null
    knowledge_demand_id: string | null
  }>(
    `SELECT
       candidate.id,
       candidate.pipeline_task_id,
       task.source_candidate_id,
       source.knowledge_demand_id
     FROM knowledge_candidates candidate
     JOIN pipeline_tasks task ON task.id = candidate.pipeline_task_id
     LEFT JOIN source_candidates source
       ON source.id = task.source_candidate_id
     WHERE candidate.status = 'verified'
       AND candidate.publication_task_id IS NULL
     ORDER BY
       CASE WHEN source.knowledge_demand_id IS NOT NULL THEN 0 ELSE 1 END,
       candidate.updated_at,
       candidate.created_at
     LIMIT 50
     FOR UPDATE OF candidate SKIP LOCKED`,
  )
  if (batch.rows.length === 0) return false
  const candidateIds = batch.rows.map((candidate) => candidate.id)
  const sourceIds = [
    ...new Set(
      batch.rows.flatMap((candidate) =>
        candidate.source_candidate_id
          ? [candidate.source_candidate_id]
          : [],
      ),
    )
  ]
  const demandIds = [
    ...new Set(
      batch.rows.flatMap((candidate) =>
        candidate.knowledge_demand_id
          ? [candidate.knowledge_demand_id]
          : [],
      ),
    )
  ]
  const taskId = await insertTask(client, {
    type: 'candidate_publication',
    stage: 'publish',
    priority: demandIds.length > 0 ? 120 : 98,
    dedupeKey: `records:publish:${sha256Label(candidateIds.join(','))}`,
    sourceId: sourceIds.length === 1 ? sourceIds[0]! : null,
    knowledgeDemandId: demandIds.length === 1 ? demandIds[0]! : null,
    payload: {
      candidate_ids: candidateIds,
      source_ids: sourceIds,
      record_count: candidateIds.length
    }
  })
  if (!taskId) return false
  await client.query(
    `UPDATE knowledge_candidates
        SET publication_task_id = $1,
            updated_at = now()
      WHERE id = ANY($2::uuid[])
        AND status = 'verified'
        AND publication_task_id IS NULL`,
    [taskId, candidateIds],
  )
  return true
}

async function maintainPreparedSourceBuffer(
  client: DatabaseClient,
  target: number,
): Promise<void> {
  const buffered = await client.query<{ count: number }>(
    `SELECT count(*)::int AS count
     FROM source_candidates
     WHERE status IN (
       'approved',
       'acquiring',
       'acquired',
       'converting',
       'converted',
       'chunking',
       'prepared'
     )`,
  )
  let available = Math.max(
    0,
    target - (buffered.rows[0]?.count ?? 0),
  )
  const prepared = await client.query<{ count: number }>(
    `SELECT count(*)::int AS count
     FROM source_candidates
     WHERE status = 'prepared'`,
  )
  const preparationLimit = Math.max(
    0,
    target - (prepared.rows[0]?.count ?? 0),
  )
  const preparationSources = await client.query<{ id: string }>(
    `SELECT id
     FROM source_candidates
     WHERE status IN (
       'approved',
       'acquiring',
       'acquired',
       'converting',
       'converted',
       'chunking'
     )
     ORDER BY
       CASE WHEN knowledge_demand_id IS NOT NULL THEN 0 ELSE 1 END,
       discovered_at
     LIMIT $1
     FOR UPDATE SKIP LOCKED`,
    [preparationLimit],
  )
  for (const source of preparationSources.rows) {
    await queueSourceWork(client, source.id, 'mechanical')
  }
  if (available === 0) return

  const discovered = await client.query<{ id: string }>(
    `SELECT id
     FROM source_candidates
     WHERE status = 'discovered'
     ORDER BY
       CASE WHEN knowledge_demand_id IS NOT NULL THEN 0 ELSE 1 END,
       discovered_at
     LIMIT $1
     FOR UPDATE SKIP LOCKED`,
    [available],
  )
  for (const source of discovered.rows) {
    await client.query(
      `UPDATE source_candidates
          SET status = 'approved',
              updated_at = now()
        WHERE id = $1
          AND status = 'discovered'`,
      [source.id],
    )
    await queueSourceWork(client, source.id, 'mechanical')
    available -= 1
    if (available <= 0) break
  }
}

async function sourceSupplyNeedsDiscovery(
  client: DatabaseClient,
  target: number,
): Promise<boolean> {
  if (target <= 0) return false
  const supply = await client.query<{ count: number }>(
    `SELECT count(*)::int AS count
     FROM source_candidates
     WHERE status IN (
       'discovered',
       'approved',
       'acquiring',
       'acquired',
       'converting',
       'converted',
       'chunking',
       'prepared',
       'analyzing'
     )`,
  )
  return (supply.rows[0]?.count ?? 0) < target
}

async function reconcileSourceLanes(
  client: DatabaseClient,
  maxActiveSources: number,
): Promise<string[]> {
  await client.query(
    `UPDATE source_candidates source
        SET status = 'verifying',
            updated_at = now()
      WHERE source.status IN ('prepared', 'analyzing')
        AND NOT EXISTS (
          SELECT 1
          FROM source_artifacts artifact
          JOIN source_fragments fragment
            ON fragment.source_artifact_id = artifact.id
          WHERE artifact.source_candidate_id = source.id
            AND fragment.status IN ('queued', 'reserved', 'analyzing')
        )`,
  )
  await client.query(
    `DELETE FROM active_source_slots slot
     WHERE slot.slot_number > $1
        OR NOT EXISTS (
          SELECT 1
          FROM source_artifacts artifact
          JOIN source_fragments fragment
            ON fragment.source_artifact_id = artifact.id
          WHERE artifact.source_candidate_id = slot.source_candidate_id
            AND fragment.status IN ('queued', 'reserved', 'analyzing')
        )`,
    [maxActiveSources],
  )

  const occupied = await client.query<{
    slot_number: number
    source_candidate_id: string
  }>(
    `SELECT slot_number, source_candidate_id
     FROM active_source_slots
     WHERE slot_number <= $1
     ORDER BY slot_number
     FOR UPDATE`,
    [maxActiveSources],
  )
  const used = new Set(occupied.rows.map((row) => row.slot_number))
  for (let slot = 1; slot <= maxActiveSources; slot += 1) {
    if (used.has(slot)) continue
    const source = await client.query<{ id: string }>(
      `SELECT source.id
       FROM source_candidates source
       WHERE source.status IN ('prepared', 'analyzing')
         AND NOT EXISTS (
           SELECT 1
           FROM active_source_slots active
           WHERE active.source_candidate_id = source.id
         )
         AND EXISTS (
           SELECT 1
           FROM source_artifacts artifact
           JOIN source_fragments fragment
             ON fragment.source_artifact_id = artifact.id
           WHERE artifact.source_candidate_id = source.id
             AND fragment.status = 'queued'
             AND fragment.reservation_task_id IS NULL
         )
       ORDER BY
         CASE
           WHEN source.knowledge_demand_id IS NOT NULL THEN 0
           ELSE 1
         END,
         CASE source.status WHEN 'analyzing' THEN 0 ELSE 1 END,
         source.updated_at
       LIMIT 1
       FOR UPDATE OF source SKIP LOCKED`,
    )
    if (!source.rows[0]) break
    await client.query(
      `INSERT INTO active_source_slots (
         slot_number,
         source_candidate_id
       )
       VALUES ($1, $2)`,
      [slot, source.rows[0].id],
    )
    await client.query(
      `UPDATE source_candidates
          SET status = 'analyzing',
              updated_at = now()
        WHERE id = $1`,
      [source.rows[0].id],
    )
  }

  const active = await client.query<{ source_candidate_id: string }>(
    `SELECT source_candidate_id
     FROM active_source_slots
     WHERE slot_number <= $1
     ORDER BY slot_number`,
    [maxActiveSources],
  )
  await client.query(
    `UPDATE pipeline_settings
        SET active_source_id = $1,
            updated_at = now(),
            updated_by = 'streaming-source-scheduler'
      WHERE singleton`,
    [active.rows[0]?.source_candidate_id ?? null],
  )
  return active.rows.map((row) => row.source_candidate_id)
}

export async function reconcileCompletedSources(
  client: DatabaseClient,
): Promise<void> {
  await client.query(
    `UPDATE source_candidates source
        SET status = CASE
              WHEN EXISTS (
                SELECT 1
                FROM knowledge_candidates candidate
                JOIN pipeline_tasks task
                  ON task.id = candidate.pipeline_task_id
                WHERE task.source_candidate_id = source.id
                  AND candidate.status IN (
                    'rejected',
                    'conflict',
                    'quarantined',
                    'manual_exception'
                  )
              ) THEN 'completed_with_exceptions'
              ELSE 'completed'
            END,
            failure_code = NULL,
            failure_message = NULL,
            completed_at = coalesce(completed_at, now()),
            updated_at = now()
      WHERE source.status IN (
          'prepared',
          'analyzing',
          'verifying',
          'publishing'
        )
        AND NOT EXISTS (
          SELECT 1
          FROM source_artifacts artifact
          JOIN source_fragments fragment
            ON fragment.source_artifact_id = artifact.id
          WHERE artifact.source_candidate_id = source.id
            AND fragment.status IN ('queued', 'reserved', 'analyzing')
        )
        AND NOT EXISTS (
          SELECT 1
          FROM knowledge_candidates candidate
          JOIN pipeline_tasks task ON task.id = candidate.pipeline_task_id
          WHERE task.source_candidate_id = source.id
            AND candidate.status IN (
              'analyzed',
              'deep_review',
              'verified'
            )
        )
        AND NOT EXISTS (
          SELECT 1
          FROM pipeline_tasks task
          WHERE task.source_candidate_id = source.id
            AND task.status IN ('queued', 'claimed', 'running')
            AND task.task_type IN (
              'fragment_analysis',
              'candidate_verification',
              'candidate_deep_review',
              'candidate_publication'
            )
        )`,
  )
  await client.query(
    `UPDATE knowledge_demands demand
        SET status = 'unresolved',
            last_error_code = CASE
              WHEN EXISTS (
                SELECT 1
                FROM source_candidates rejected_source
                WHERE rejected_source.knowledge_demand_id = demand.id
                  AND rejected_source.failure_code = 'DEMAND_TERM_NOT_FOUND'
              ) THEN 'DEMAND_SOURCE_UNRELATED'
              ELSE 'KNOWLEDGE_STILL_UNKNOWN'
            END,
            -- A terminal document without an answer is feedback, not a reason
            -- to leave an urgent user question idle. The next discovery gets
            -- the completed URLs as exclusions, while an actual no-result
            -- discovery still applies its longer backoff when it submits zero
            -- distinct official sources.
            next_retry_at = now(),
            last_seen_at = now()
      WHERE demand.status IN ('acquiring', 'processing')
        AND EXISTS (
          SELECT 1
          FROM source_candidates linked_source
          WHERE linked_source.knowledge_demand_id = demand.id
        )
        AND NOT EXISTS (
          SELECT 1
          FROM source_candidates linked_source
          WHERE linked_source.knowledge_demand_id = demand.id
            AND linked_source.status NOT IN (
              'completed',
              'completed_with_exceptions',
              'duplicate',
              'rejected',
              'failed'
            )
        )
        AND NOT EXISTS (
          SELECT 1
          FROM pipeline_tasks task
          WHERE task.knowledge_demand_id = demand.id
            AND task.status IN ('queued', 'claimed', 'running')
        )`,
  )
}

async function queueVerificationFromAnySource(
  client: DatabaseClient,
): Promise<boolean> {
  const source = await client.query<{ id: string }>(
    `SELECT task.source_candidate_id AS id
     FROM knowledge_candidates candidate
     JOIN pipeline_tasks task ON task.id = candidate.pipeline_task_id
     LEFT JOIN source_candidates source
       ON source.id = task.source_candidate_id
     WHERE candidate.status = 'analyzed'
       AND candidate.verification_task_id IS NULL
       AND task.source_candidate_id IS NOT NULL
     GROUP BY task.source_candidate_id
     ORDER BY
       min(
         CASE WHEN source.knowledge_demand_id IS NOT NULL THEN 0 ELSE 1 END
       ),
       min(candidate.created_at)
     LIMIT 1`,
  )
  return source.rows[0]
    ? queueSourceWork(client, source.rows[0].id, 'verification')
    : false
}

async function queueAnalysisFromLanes(
  client: DatabaseClient,
  sourceIds: string[],
): Promise<boolean> {
  for (const sourceId of sourceIds) {
    if (await queueSourceWork(client, sourceId, 'analysis')) return true
  }
  return false
}

async function ensureLegacyWorkInTransaction(
  client: DatabaseClient,
): Promise<void> {
  await reconcileExpiredAndCompletedWork(client)
  const settings = await client.query<{
    enabled: boolean
    ai_model: string
    reasoning_effort: string
    max_concurrent_ai_runs: number
    max_active_sources: number
    max_deep_review_runs: number
    source_buffer_target: number
  }>(
    `SELECT
       enabled,
       ai_model,
       reasoning_effort,
       max_concurrent_ai_runs,
       max_active_sources,
       max_deep_review_runs,
       source_buffer_target
     FROM pipeline_settings
     WHERE singleton
     FOR UPDATE`,
  )
  const pipeline = settings.rows[0]
  if (!pipeline?.enabled) return
  if (
    pipeline.ai_model !== requiredPipelineModel ||
    pipeline.reasoning_effort !== requiredPipelineReasoning
  ) {
    throw new Error('PIPELINE_LUNA_CONFIGURATION_REQUIRED')
  }

  // Always materialize a newly-arrived expert task, even when every Luna slot
  // is occupied. Claim ordering then guarantees it receives the next free slot.
  await queueExpertWork(client)

  await client.query(
    `DELETE FROM active_source_slots slots
     USING source_candidates source
     WHERE source.id = slots.source_candidate_id
       AND (
         source.status IN (
           'completed',
           'completed_with_exceptions',
           'duplicate',
           'rejected'
         )
         OR (
           source.status IN ('verifying', 'failed')
           AND EXISTS (
             SELECT 1
             FROM pipeline_tasks deep_source_task
             JOIN knowledge_candidates deep_candidate
               ON deep_candidate.pipeline_task_id =
                  deep_source_task.id
             WHERE deep_source_task.source_candidate_id = source.id
               AND deep_candidate.status = 'deep_review'
           )
           AND NOT EXISTS (
             SELECT 1
             FROM pipeline_tasks active_source_task
             WHERE active_source_task.source_candidate_id = source.id
               AND active_source_task.status IN (
                 'queued',
                 'claimed',
                 'running'
               )
               AND active_source_task.task_type <>
                 'candidate_deep_review'
           )
           AND NOT EXISTS (
             SELECT 1
             FROM source_artifacts active_artifact
             JOIN source_fragments active_fragment
               ON active_fragment.source_artifact_id =
                  active_artifact.id
             WHERE active_artifact.source_candidate_id = source.id
               AND active_fragment.status IN (
                 'queued',
                 'reserved',
                 'analyzing'
               )
           )
           AND NOT EXISTS (
             SELECT 1
             FROM pipeline_tasks pending_source_task
             JOIN knowledge_candidates pending_candidate
               ON pending_candidate.pipeline_task_id =
                  pending_source_task.id
             WHERE pending_source_task.source_candidate_id = source.id
               AND pending_candidate.status IN (
                 'analyzed',
                 'verifying'
               )
           )
         )
       )`,
  )

  const occupiedSourceSlots = await client.query<{ slot_number: number }>(
    `SELECT slot_number
     FROM active_source_slots
     ORDER BY slot_number
     FOR UPDATE`,
  )
  const occupiedNumbers = new Set(
    occupiedSourceSlots.rows.map((slot) => slot.slot_number),
  )
  for (
    let slotNumber = 1;
    slotNumber <= pipeline.max_active_sources;
    slotNumber += 1
  ) {
    if (occupiedNumbers.has(slotNumber)) continue
    const source = await client.query<{ id: string }>(
      `SELECT sc.id
       FROM source_candidates sc
       WHERE (
         sc.status IN (
           'discovered',
           'approved',
           'acquiring',
           'acquired',
           'converting',
           'converted',
           'chunking',
           'analyzing',
           'verifying',
           'publishing'
         )
         OR (
           sc.status = 'failed'
           AND EXISTS (
             SELECT 1
             FROM knowledge_candidates kc
             JOIN pipeline_tasks pt ON pt.id = kc.pipeline_task_id
             WHERE pt.source_candidate_id = sc.id
               AND kc.status IN ('verified', 'deep_review', 'quarantined')
           )
         )
       )
         AND NOT EXISTS (
           SELECT 1
           FROM active_source_slots active
           WHERE active.source_candidate_id = sc.id
         )
         AND NOT (
           sc.status IN ('verifying', 'failed')
           AND EXISTS (
             SELECT 1
             FROM pipeline_tasks deep_source_task
             JOIN knowledge_candidates deep_candidate
               ON deep_candidate.pipeline_task_id =
                  deep_source_task.id
             WHERE deep_source_task.source_candidate_id = sc.id
               AND deep_candidate.status = 'deep_review'
           )
           AND NOT EXISTS (
             SELECT 1
             FROM pipeline_tasks active_source_task
             WHERE active_source_task.source_candidate_id = sc.id
               AND active_source_task.status IN (
                 'queued',
                 'claimed',
                 'running'
               )
               AND active_source_task.task_type <>
                 'candidate_deep_review'
           )
           AND NOT EXISTS (
             SELECT 1
             FROM source_artifacts active_artifact
             JOIN source_fragments active_fragment
               ON active_fragment.source_artifact_id =
                  active_artifact.id
             WHERE active_artifact.source_candidate_id = sc.id
               AND active_fragment.status IN (
                 'queued',
                 'reserved',
                 'analyzing'
               )
           )
           AND NOT EXISTS (
             SELECT 1
             FROM pipeline_tasks pending_source_task
             JOIN knowledge_candidates pending_candidate
               ON pending_candidate.pipeline_task_id =
                  pending_source_task.id
             WHERE pending_source_task.source_candidate_id = sc.id
               AND pending_candidate.status IN (
                 'analyzed',
                 'verifying'
               )
           )
         )
       ORDER BY
         CASE sc.status
           WHEN 'publishing' THEN 0
           WHEN 'verifying' THEN 1
           WHEN 'analyzing' THEN 2
           ELSE 3
         END,
         sc.discovered_at
       LIMIT 1
       FOR UPDATE OF sc SKIP LOCKED`,
    )
    const sourceId = source.rows[0]?.id
    if (!sourceId) break
    await client.query(
      `INSERT INTO active_source_slots (
         slot_number, source_candidate_id
       )
       VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [slotNumber, sourceId],
    )
  }

  const activeSources = await client.query<{
    source_candidate_id: string
  }>(
    `SELECT source_candidate_id
     FROM active_source_slots
     WHERE slot_number <= $1
     ORDER BY slot_number`,
    [pipeline.max_active_sources],
  )
  await client.query(
    `UPDATE pipeline_settings
        SET active_source_id = $1,
            updated_at = now(),
            updated_by = 'multi-source-scheduler'
      WHERE singleton`,
    [activeSources.rows[0]?.source_candidate_id ?? null],
  )
  for (const source of activeSources.rows) {
    await queueSourceWork(
      client,
      source.source_candidate_id,
      'mechanical',
    )
  }

  const activeAi = await client.query<{ count: number }>(
    `SELECT count(*)::int AS count
     FROM pipeline_tasks
     WHERE (
       status IN ('claimed', 'running')
       OR (
         status = 'queued'
         AND task_type NOT IN ('source_discovery', 'source_refresh')
       )
     )
       AND task_type = ANY($1::text[])`,
    [aiTaskTypes],
  )
  let occupiedSlots = activeAi.rows[0]?.count ?? 0
  const activeDeep = await client.query<{ count: number }>(
    `SELECT count(*)::int AS count
     FROM pipeline_tasks
     WHERE status IN ('queued', 'claimed', 'running')
       AND task_type = 'candidate_deep_review'`,
  )
  if (
    occupiedSlots < pipeline.max_concurrent_ai_runs &&
    (activeDeep.rows[0]?.count ?? 0) <
      pipeline.max_deep_review_runs &&
    await queueDeepReviewWork(client, 'low')
  ) {
    occupiedSlots += 1
  }

  const activeAnalysis = await client.query<{ count: number }>(
    `SELECT count(*)::int AS count
     FROM pipeline_tasks
     WHERE status IN ('queued', 'claimed', 'running')
       AND task_type = 'fragment_analysis'`,
  )
  let analysisSlots = activeAnalysis.rows[0]?.count ?? 0
  const desiredAnalysisSlots = Math.min(
    2,
    pipeline.max_concurrent_ai_runs,
  )
  let madeAnalysisProgress = true
  while (
    occupiedSlots < pipeline.max_concurrent_ai_runs &&
    analysisSlots < desiredAnalysisSlots &&
    madeAnalysisProgress
  ) {
    madeAnalysisProgress = false
    for (const source of activeSources.rows) {
      if (
        occupiedSlots >= pipeline.max_concurrent_ai_runs ||
        analysisSlots >= desiredAnalysisSlots
      ) {
        break
      }
      if (
        await queueSourceWork(
          client,
          source.source_candidate_id,
          'analysis',
        )
      ) {
        occupiedSlots += 1
        analysisSlots += 1
        madeAnalysisProgress = true
      }
    }
  }

  let madeSourceProgress = true
  while (
    occupiedSlots < pipeline.max_concurrent_ai_runs &&
    madeSourceProgress
  ) {
    madeSourceProgress = false
    for (const source of activeSources.rows) {
      if (occupiedSlots >= pipeline.max_concurrent_ai_runs) break
      if (
        await queueSourceWork(
          client,
          source.source_candidate_id,
          'ai',
        )
      ) {
        occupiedSlots += 1
        madeSourceProgress = true
      }
    }
  }

  while (occupiedSlots < pipeline.max_concurrent_ai_runs) {
    let queued = await queueExpertWork(client)
    if (!queued) {
      const sourceBuffer = await client.query<{ count: number }>(
        `SELECT count(*)::int AS count
         FROM source_candidates
         WHERE status IN ('discovered', 'approved')`,
      )
      queued =
        (sourceBuffer.rows[0]?.count ?? 0) <
          pipeline.source_buffer_target
          ? await queueDiscoveryWork(client)
          : false
    }
    if (!queued) break
    occupiedSlots += 1
  }
}

async function ensureStreamingWorkInTransaction(
  client: DatabaseClient,
): Promise<void> {
  await reconcileExpiredAndCompletedWork(client)
  const settings = await client.query<{
    enabled: boolean
    ai_model: string
    reasoning_effort: string
    max_concurrent_ai_runs: number
    max_active_sources: number
    source_buffer_target: number
    prepared_source_target: number
  }>(
    `SELECT
       enabled,
       ai_model,
       reasoning_effort,
       max_concurrent_ai_runs,
       max_active_sources,
       source_buffer_target,
       prepared_source_target
     FROM pipeline_settings
     WHERE singleton
     FOR UPDATE`,
  )
  const pipeline = settings.rows[0]
  if (!pipeline?.enabled) return
  if (
    pipeline.ai_model !== requiredPipelineModel ||
    pipeline.reasoning_effort !== requiredPipelineReasoning
  ) {
    throw new Error('PIPELINE_LUNA_CONFIGURATION_REQUIRED')
  }

  await reconcileCompletedSources(client)
  await reconcileTechnicalDemandFailures(client)
  await maintainPreparedSourceBuffer(
    client,
    pipeline.prepared_source_target,
  )
  const activeSourceIds = await reconcileSourceLanes(
    client,
    pipeline.max_active_sources,
  )

  // Publication is deterministic and independent from source completion.
  // Reserve several batches so the mechanical worker can drain a large
  // verified backlog without waiting for the next AI heartbeat.
  for (let batch = 0; batch < 8; batch += 1) {
    if (!(await queueCandidatePublication(client))) break
  }

  // A real unanswered MCP request outranks background coverage and record
  // refinement. Expert work remains the next highest class.
  await queueDemandDiscoveryWork(client)

  // Keep one future Luna claim available for intake whenever the prepared
  // supply falls below its target. Without this reservation an endless Deep
  // Review backlog can consume every lane and leave no documents ready when
  // it finally drains. Existing runs are never interrupted.
  if (await sourceSupplyNeedsDiscovery(
    client,
    pipeline.prepared_source_target,
  )) {
    await queueDiscoveryWork(client)
  }
  await queueExpertWork(client)
  // Tasks can survive an application deployment. Normalize every unclaimed
  // AI task so an older numeric priority cannot defeat the current policy.
  await client.query(
    `UPDATE pipeline_tasks
        SET priority = CASE
          WHEN knowledge_demand_id IS NOT NULL THEN 120::smallint
          WHEN task_type = 'expert_research' THEN $1::smallint
          WHEN task_type = 'candidate_deep_review'
            AND requested_reasoning_effort = 'medium' THEN $2::smallint
          WHEN task_type = 'candidate_deep_review'
            AND payload->>'review_pass' = 'fallback_low' THEN $3::smallint
          WHEN task_type = 'candidate_deep_review' THEN $4::smallint
          WHEN task_type = 'candidate_verification' THEN $5::smallint
          WHEN task_type = 'fragment_analysis' THEN $6::smallint
          ELSE $7::smallint
        END,
        updated_at = now()
      WHERE status = 'queued'
        AND task_type = ANY($8::text[])
        AND priority IS DISTINCT FROM CASE
          WHEN knowledge_demand_id IS NOT NULL THEN 120::smallint
          WHEN task_type = 'expert_research' THEN $1::smallint
          WHEN task_type = 'candidate_deep_review'
            AND requested_reasoning_effort = 'medium' THEN $2::smallint
          WHEN task_type = 'candidate_deep_review'
            AND payload->>'review_pass' = 'fallback_low' THEN $3::smallint
          WHEN task_type = 'candidate_deep_review' THEN $4::smallint
          WHEN task_type = 'candidate_verification' THEN $5::smallint
          WHEN task_type = 'fragment_analysis' THEN $6::smallint
          ELSE $7::smallint
        END`,
    [
      aiPriorities.expert,
      aiPriorities.deepMedium,
      aiPriorities.deepMediumFallback,
      aiPriorities.deepLow,
      aiPriorities.verify,
      aiPriorities.analyze,
      aiPriorities.discover,
      aiTaskTypes
    ],
  )
  // A scoped circuit protects only the exact failing Luna work class.  Queued
  // work behind an open circuit is intentionally not claimable, so it must
  // not consume scheduler capacity either: otherwise a Deep Medium incident
  // can make the other three executors look "full" while Analyze and Verify
  // records wait untouched.
  const blockedCircuits = await client.query<AiCircuitRow>(
    `SELECT task_type, reasoning_effort, open_until, probe_executor_id
       FROM pipeline_ai_circuits
      WHERE open_until > now()
         OR probe_executor_id IS NOT NULL`,
  )
  const isCircuitBlocked = (
    taskType: PipelineTaskRow['task_type'],
    reasoningEffort: 'low' | 'medium',
  ) => blockedCircuits.rows.some((circuit) =>
    circuit.task_type === taskType &&
    circuit.reasoning_effort === reasoningEffort,
  )
  const activeAi = await client.query<{
    scheduler_stage: WeightedAiStage | 'expert' | 'discover'
    count: number
  }>(
    `SELECT
       CASE
         WHEN task_type = 'expert_research' THEN 'expert'
         WHEN task_type = 'candidate_deep_review'
           AND (
             requested_reasoning_effort = 'medium'
             OR payload->>'review_pass' = 'fallback_low'
           )
           THEN 'deep_medium'
         WHEN task_type = 'candidate_deep_review' THEN 'deep_low'
         WHEN task_type = 'candidate_verification' THEN 'verify'
         WHEN task_type = 'fragment_analysis' THEN 'analyze'
         ELSE 'discover'
       END AS scheduler_stage,
       count(*)::int AS count
     FROM pipeline_tasks
     WHERE (
         status IN ('claimed', 'running')
         OR (
           status = 'queued'
           AND available_at <= now()
           AND NOT EXISTS (
             SELECT 1
             FROM pipeline_ai_circuits circuit
             WHERE circuit.task_type = pipeline_tasks.task_type
               AND circuit.reasoning_effort = coalesce(
                 pipeline_tasks.requested_reasoning_effort,
                 'low'
               )
               AND (
                 circuit.open_until > now()
                 OR circuit.probe_executor_id IS NOT NULL
               )
           )
         )
       )
       AND task_type = ANY($1::text[])
     GROUP BY scheduler_stage`,
    [aiTaskTypes],
  )
  const activeCounts: Record<WeightedAiStage, number> = {
    deep_medium: 0,
    deep_low: 0,
    verify: 0,
    analyze: 0
  }
  let occupied = 0
  for (const row of activeAi.rows) {
    occupied += row.count
    if (row.scheduler_stage in activeCounts) {
      activeCounts[row.scheduler_stage as WeightedAiStage] = row.count
    }
  }

  const queueByStage: Record<
    WeightedAiStage,
    () => Promise<boolean>
  > = {
    deep_medium: async () => {
      if (
        !isCircuitBlocked('candidate_deep_review', 'medium') &&
        await queueDeepReviewWork(client, 'medium')
      ) {
        return true
      }
      // A scoped Medium circuit must not strand a batch forever. After the
      // candidate has exhausted repeated *technical* Medium attempts, use a
      // separate Luna-low pass against the same official evidence. It is
      // explicitly terminal: verify only a fully supported claim, otherwise
      // reject/conflict; it can never silently escalate a risky claim.
      return !isCircuitBlocked('candidate_deep_review', 'low') &&
        queueDeepReviewWork(client, 'fallback_low')
    },
    deep_low: () => isCircuitBlocked(
      'candidate_deep_review',
      'low',
    )
      ? Promise.resolve(false)
      : queueDeepReviewWork(client, 'low'),
    verify: () => queueVerificationFromAnySource(client),
    analyze: () => queueAnalysisFromLanes(client, activeSourceIds)
  }
  const allocation = await fillWeightedAiCapacity({
    concurrency: pipeline.max_concurrent_ai_runs,
    occupied,
    activeByStage: activeCounts,
    queueStage: (stage) => queueByStage[stage]()
  })
  occupied = allocation.occupied

  // Discovery is intentionally last and limited to one lane. Mechanical
  // collection expansion keeps the source buffer useful without displacing
  // records that are already closer to publication.
  if (occupied < pipeline.max_concurrent_ai_runs) {
    const sourceBuffer = await client.query<{ count: number }>(
      `SELECT count(*)::int AS count
       FROM source_candidates
       WHERE status IN ('discovered', 'approved')`,
    )
    if (
      (sourceBuffer.rows[0]?.count ?? 0) <
      pipeline.source_buffer_target
    ) {
      await queueDiscoveryWork(client)
    }
  }
}

export async function ensurePipelineWork(
  database: Database,
): Promise<void> {
  await withTransaction(database, ensureStreamingWorkInTransaction)
}

export async function claimPipelineTask(
  database: Database,
  config: AppConfig,
  researcherId: string,
  researcherInstanceId = researcherId,
): Promise<Record<string, unknown>> {
  await ensurePipelineWork(database)
  return withTransaction(database, async (client) => {
    const settings = await client.query<{
      enabled: boolean
      ai_model: string
      reasoning_effort: string
      max_concurrent_ai_runs: number
      max_deep_review_runs: number
    }>(
      `SELECT
         enabled,
         ai_model,
         reasoning_effort,
         max_concurrent_ai_runs,
         max_deep_review_runs
       FROM pipeline_settings
       WHERE singleton
       FOR UPDATE`,
    )
    const pipeline = settings.rows[0]
    if (!pipeline?.enabled) {
      await recordExecutorHeartbeat(
        client,
        researcherId,
        researcherInstanceId,
        { status: 'paused' },
      )
      return { enabled: false, reason: 'pipeline_paused' }
    }
    if (
      pipeline.ai_model !== requiredPipelineModel ||
      pipeline.reasoning_effort !== requiredPipelineReasoning
    ) {
      throw new Error('PIPELINE_LUNA_CONFIGURATION_REQUIRED')
    }
    // A deployment or local supervisor restart can terminate the sole circuit
    // probe after it has reserved the circuit but before it can submit a
    // result.  Do not let that dead reservation suppress the work class
    // indefinitely. A reservation remains intact while its exact AI task has
    // a live lease, so this cannot create two concurrent probes.
    await client.query(
      `UPDATE pipeline_ai_circuits circuit
          SET probe_executor_id = NULL,
              updated_at = now()
        WHERE circuit.probe_executor_id IS NOT NULL
          AND NOT EXISTS (
            SELECT 1
            FROM pipeline_tasks task
            WHERE task.claim_owner = circuit.probe_executor_id
              AND task.task_type = circuit.task_type
              AND coalesce(task.requested_reasoning_effort, 'low') =
                  circuit.reasoning_effort
              AND task.status IN ('claimed', 'running')
              AND task.lease_until > now()
          )`,
    )
    // A Codex incident is isolated to the exact Luna work class that exposed
    // it.  Deep Medium may be paused while useful discovery, analysis and
    // verification continue to fill and advance the knowledge pipeline.
    const circuits = await client.query<AiCircuitRow>(
      `SELECT task_type, reasoning_effort, open_until, probe_executor_id
       FROM pipeline_ai_circuits
       FOR UPDATE`,
    )
    const runningAi = await client.query<{ count: number }>(
      `SELECT count(*)::int AS count
       FROM pipeline_tasks
       WHERE status IN ('claimed', 'running')
         AND task_type = ANY($1::text[])`,
      [aiTaskTypes],
    )
    const activeRuns = runningAi.rows[0]?.count ?? 0
    if (activeRuns >= pipeline.max_concurrent_ai_runs) {
      await recordExecutorHeartbeat(
        client,
        researcherId,
        researcherInstanceId,
        {
          status: 'standby',
          reason: 'capacity_reached',
          configured_concurrency: pipeline.max_concurrent_ai_runs,
          active_luna_runs: activeRuns
        },
      )
      return {
        enabled: true,
        pipeline_state: 'capacity_reached',
        configured_concurrency: pipeline.max_concurrent_ai_runs,
        active_luna_runs: activeRuns
      }
    }

    const selected = await client.query<PipelineTaskRow>(
      `SELECT
         id,
         task_type,
         stage,
         payload,
         coverage_target_id,
         source_candidate_id,
         expert_task_id,
         knowledge_demand_id,
         requested_reasoning_effort
       FROM pipeline_tasks
       WHERE status = 'queued'
         AND available_at <= now()
         AND task_type = ANY($1::text[])
         AND NOT EXISTS (
           SELECT 1
           FROM pipeline_ai_circuits circuit
           WHERE circuit.task_type = pipeline_tasks.task_type
             AND circuit.reasoning_effort = coalesce(
               pipeline_tasks.requested_reasoning_effort,
               'low'
             )
             AND (
               circuit.open_until > now()
               OR circuit.probe_executor_id IS NOT NULL
             )
         )
         AND (
           task_type NOT IN ('source_discovery', 'source_refresh')
           OR knowledge_demand_id IS NOT NULL
           OR NOT EXISTS (
             SELECT 1
             FROM pipeline_tasks active_discovery
             WHERE active_discovery.status IN ('claimed', 'running')
               AND active_discovery.task_type IN (
                 'source_discovery',
                 'source_refresh'
               )
           )
         )
       ORDER BY priority DESC, created_at
       FOR UPDATE SKIP LOCKED
       LIMIT 1`,
      [aiTaskTypes],
    )
    const task = selected.rows[0]
    if (!task) {
      const activeMechanical = await client.query<{
        task_type: PipelineTaskRow['task_type']
        stage: PipelineTaskRow['stage']
        status: string
      }>(
        `SELECT task_type, stage, status
         FROM pipeline_tasks
         WHERE status IN ('queued', 'claimed', 'running')
         ORDER BY priority DESC, created_at
         LIMIT 1`,
      )
      await recordExecutorHeartbeat(
        client,
        researcherId,
        researcherInstanceId,
        activeMechanical.rows[0]
          ? {
              status: 'standby',
              reason: 'deterministic_work_in_progress',
              stage: activeMechanical.rows[0].stage,
              task_type: activeMechanical.rows[0].task_type
            }
          : {
              status: 'standby',
              reason: 'scheduler_refill'
            },
      )
      return {
        enabled: true,
        pipeline_state: circuits.rows.some((circuit) =>
          new Date(circuit.open_until).getTime() > Date.now() ||
          circuit.probe_executor_id !== null,
        )
          ? 'scoped_ai_circuit_open'
          : activeMechanical.rows[0]
            ? 'pipeline_work_in_progress'
            : 'scheduler_refill',
        ...(activeMechanical.rows[0]
          ? {
              active_task_type: activeMechanical.rows[0].task_type,
              active_stage: activeMechanical.rows[0].stage
            }
          : {})
      }
    }

    const taskReasoning = task.requested_reasoning_effort ?? 'low'
    const expiredCircuit = circuits.rows.find((circuit) =>
      circuit.task_type === task.task_type &&
      circuit.reasoning_effort === taskReasoning &&
      circuit.probe_executor_id === null &&
      new Date(circuit.open_until).getTime() <= Date.now(),
    )
    if (expiredCircuit) {
      const probe = await client.query<{ task_type: string }>(
        `UPDATE pipeline_ai_circuits
            SET probe_executor_id = $3,
                updated_at = now()
          WHERE task_type = $1
            AND reasoning_effort = $2
            AND probe_executor_id IS NULL
            AND open_until <= now()
          RETURNING task_type`,
        [task.task_type, taskReasoning, researcherId],
      )
      if (!probe.rows[0]) throw new Error('AI_CIRCUIT_PROBE_NOT_AVAILABLE')
    }

    const leaseToken = randomUrlToken()
    const leaseUntil = new Date(
      Date.now() + config.taskLeaseSeconds * 1_000,
    )
    await client.query(
      `UPDATE pipeline_tasks
          SET status = 'running',
              claim_owner = $2,
              lease_token_hash = $3,
              lease_until = $4,
              heartbeat_at = now(),
              attempts = attempts + 1,
              updated_at = now()
        WHERE id = $1`,
      [
        task.id,
        researcherId,
        sha256(leaseToken),
        leaseUntil.toISOString()
      ],
    )
    const run = await client.query<{ id: string }>(
      `INSERT INTO agent_runs (
         pipeline_task_id,
         model,
         reasoning_effort,
         status
       )
       SELECT $1, ai_model, $2, 'running'
       FROM pipeline_settings
       WHERE singleton
       RETURNING id`,
      [task.id, taskReasoning],
    )
    await client.query(
      `UPDATE agent_runs
          SET executor_id = $2
        WHERE id = $1`,
      [run.rows[0]!.id, researcherId],
    )
    await recordExecutorHeartbeat(
      client,
      researcherId,
      researcherInstanceId,
      {
        status: 'running',
        model: pipeline.ai_model,
        reasoning_effort: taskReasoning,
        task_id: task.id,
        task_type: task.task_type,
        stage: task.stage
      },
    )

    let payload = task.payload
    if (task.task_type === 'expert_research' && task.expert_task_id) {
      const expert = await client.query<{
        public_id: string
        question: string
        network_context: Record<string, unknown>
      }>(
        `UPDATE expert_tasks
            SET status = 'researching',
                claim_owner = $2,
                lease_token_hash = $3,
                lease_until = $4,
                heartbeat_at = now(),
                attempts = attempts + 1,
                updated_at = now()
          WHERE id = $1
            AND status = 'queued'
          RETURNING public_id, question, network_context`,
        [
          task.expert_task_id,
          researcherId,
          sha256(leaseToken),
          leaseUntil.toISOString()
        ],
      )
      if (!expert.rows[0]) throw new Error('EXPERT_TASK_NOT_AVAILABLE')
      payload = {
        ...payload,
        task_id: expert.rows[0].public_id,
        question: expert.rows[0].question,
        network_context: expert.rows[0].network_context
      }
    }

    if (task.knowledge_demand_id) {
      const demand = await client.query<Omit<LeasedKnowledgeDemand, 'excluded_source_urls'>>(
        `SELECT question, tool_name, context
         FROM knowledge_demands
         WHERE id = $1`,
        [task.knowledge_demand_id],
      )
      if (demand.rows[0]) {
        const exhaustedSources = await client.query<{ canonical_url: string }>(
          `SELECT canonical_url
           FROM source_candidates
           WHERE knowledge_demand_id = $1
             AND status IN (
               'completed',
               'completed_with_exceptions',
               'duplicate',
               'rejected',
               'failed'
             )
           ORDER BY completed_at DESC NULLS LAST, updated_at DESC
           LIMIT 20`,
          [task.knowledge_demand_id],
        )
        payload = withLeasedKnowledgeDemand(payload, {
          ...demand.rows[0],
          excluded_source_urls: exhaustedSources.rows.map(
            (source) => source.canonical_url,
          ),
        })
      }
    }

    if (task.task_type === 'fragment_analysis') {
      const fragmentIds = (
        Array.isArray(payload['fragments'])
          ? payload['fragments']
          : []
      ).flatMap((fragment) =>
        fragment &&
        typeof fragment === 'object' &&
        'id' in fragment &&
        typeof fragment.id === 'string'
          ? [fragment.id]
          : [],
      )
      if (fragmentIds.length > 0) {
        await client.query(
          `UPDATE source_fragments
              SET status = 'analyzing',
                  attempts = attempts + 1,
                  updated_at = now()
            WHERE id = ANY($1::uuid[])
              AND status = 'reserved'
              AND reservation_task_id = $2`,
          [fragmentIds, task.id],
        )
      }
    }

    await recordEvent(client, {
      taskId: task.id,
      sourceId: task.source_candidate_id,
      stage: task.stage,
      event: 'claimed',
      message: `${researcherId} claimed useful ${task.stage} work.`
    })
    return {
      enabled: true,
      pipeline_task_id: task.id,
      task_type: task.task_type,
      stage: task.stage,
      lease_token: leaseToken,
      lease_until: leaseUntil.toISOString(),
      agent_run_id: run.rows[0]!.id,
      requested_reasoning_effort:
        task.requested_reasoning_effort ?? 'low',
      payload
    }
  })
}

export async function claimMechanicalPipelineTask(
  database: Database,
  config: AppConfig,
  workerId: string,
): Promise<{
  task: PipelineTaskRow
  leaseToken: string
} | null> {
  await ensurePipelineWork(database)
  return withTransaction(database, async (client) => {
    const settings = await client.query<{ enabled: boolean }>(
      `SELECT enabled FROM pipeline_settings WHERE singleton FOR UPDATE`,
    )
    if (!settings.rows[0]?.enabled) return null

    const selected = await client.query<PipelineTaskRow>(
      `SELECT
         id,
         task_type,
         stage,
         payload,
         coverage_target_id,
         source_candidate_id,
         expert_task_id
       FROM pipeline_tasks
       WHERE status = 'queued'
         AND available_at <= now()
         AND task_type = ANY($1::text[])
       ORDER BY priority DESC, created_at
       FOR UPDATE SKIP LOCKED
       LIMIT 1`,
      [mechanicalTaskTypes],
    )
    const task = selected.rows[0]
    if (!task) return null

    const leaseToken = randomUrlToken()
    const leaseUntil = new Date(
      Date.now() + config.taskLeaseSeconds * 1_000,
    )
    await client.query(
      `UPDATE pipeline_tasks
          SET status = 'running',
              claim_owner = $2,
              lease_token_hash = $3,
              lease_until = $4,
              heartbeat_at = now(),
              attempts = attempts + 1,
              updated_at = now()
        WHERE id = $1`,
      [
        task.id,
        workerId,
        sha256(leaseToken),
        leaseUntil.toISOString()
      ],
    )
    if (task.source_candidate_id) {
      const sourceStatuses: Partial<
        Record<PipelineTaskRow['task_type'], string>
      > = {
        source_acquisition: 'acquiring',
        source_conversion: 'converting',
        source_chunking: 'chunking',
        source_publication: 'publishing'
      }
      const sourceStatus = sourceStatuses[task.task_type]
      if (sourceStatus) {
        await client.query(
          `UPDATE source_candidates
              SET status = $2,
                  updated_at = now()
            WHERE id = $1`,
          [task.source_candidate_id, sourceStatus],
        )
      }
    }
    await recordEvent(client, {
      taskId: task.id,
      sourceId: task.source_candidate_id,
      stage: task.stage,
      event: 'started',
      message: `${workerId} started deterministic ${task.stage} work.`
    })
    return { task, leaseToken }
  })
}

export async function completeMechanicalPipelineTask(
  database: Database,
  taskId: string,
  leaseToken: string,
  result: Record<string, unknown>,
): Promise<void> {
  await withTransaction(database, async (client) => {
    const task = await assertPipelineLease(client, taskId, leaseToken)
    if (!mechanicalTaskTypes.includes(task.task_type)) {
      throw new Error('PIPELINE_TASK_TYPE_INVALID')
    }
    await completeTask(client, task, result)
  })
  await ensurePipelineWork(database)
}

export async function getPipelineTaskStatus(
  database: Database,
  taskId: string,
): Promise<Record<string, unknown>> {
  const result = await database.query<{
    id: string
    task_type: PipelineTaskRow['task_type']
    status: string
    result: Record<string, unknown> | null
    failure_code: string | null
    expert_status: string | null
    expert_artifact_count: number
  }>(
    `SELECT
       pt.id,
       pt.task_type,
       pt.status,
       pt.result,
       pt.failure_code,
       et.status AS expert_status,
       coalesce((
         SELECT count(*)::int
         FROM task_artifacts ta
         WHERE ta.task_id = pt.expert_task_id
           AND ta.artifact_type = 'candidate_revision'
       ), 0)::int AS expert_artifact_count
     FROM pipeline_tasks pt
     LEFT JOIN expert_tasks et ON et.id = pt.expert_task_id
     WHERE pt.id = $1`,
    [taskId],
  )
  const task = result.rows[0]
  if (!task) throw new Error('PIPELINE_TASK_NOT_FOUND')
  const artifactRecorded =
    ['completed', 'failed', 'cancelled', 'skipped'].includes(task.status) ||
    (
      task.task_type === 'expert_research' &&
      task.expert_artifact_count > 0 &&
      ['validating', 'completed'].includes(task.expert_status ?? '')
    )
  return {
    pipeline_task_id: task.id,
    task_type: task.task_type,
    status: task.status,
    artifact_recorded: artifactRecorded,
    result: task.result,
    failure_code: task.failure_code,
    expert_status: task.expert_status
  }
}

export async function recordAgentRunResult(
  database: Database,
  input: z.infer<typeof agentRunResultSchema>,
): Promise<Record<string, unknown>> {
  const result = await database.query<{
    id: string
    executor_id: string | null
    task_type: PipelineTaskRow['task_type'] | null
    reasoning_effort: 'low' | 'medium'
  }>(
    `UPDATE agent_runs run
        SET status = $2,
            input_tokens = $3,
            cached_input_tokens = $4,
            output_tokens = $5,
            reasoning_output_tokens = $6,
            duration_ms = $7,
            error_code = $8,
            process_exit_code = $9,
            diagnostic_code = $10,
            diagnostic_fingerprint = $11,
            published_revisions = coalesce((
              SELECT (pt.result->>'revisions_published')::int
              FROM pipeline_tasks pt
              WHERE pt.id = run.pipeline_task_id
            ), 0),
            completed_at = now()
      FROM pipeline_tasks task
      WHERE run.id = $1
        AND run.status = 'running'
        AND task.id = run.pipeline_task_id
      RETURNING run.id,
                run.executor_id,
                task.task_type,
                run.reasoning_effort`,
    [
      input.agent_run_id,
      input.status,
      input.input_tokens,
      input.cached_input_tokens,
      input.output_tokens,
      input.reasoning_output_tokens,
      input.duration_ms,
      input.error_code ?? null,
      input.process_exit_code ?? null,
      input.diagnostic_code ?? null,
      input.diagnostic_fingerprint ?? null
    ],
  )
  if (!result.rows[0]) throw new Error('AGENT_RUN_NOT_RUNNING')
  const executorId = result.rows[0].executor_id
  const taskType = result.rows[0].task_type
  const reasoningEffort = result.rows[0].reasoning_effort
  if (
    input.status === 'completed' &&
    executorId &&
    taskType &&
    isAiTaskType(taskType)
  ) {
    await database.query(
      `DELETE FROM pipeline_ai_circuits
       WHERE task_type = $1
         AND reasoning_effort = $2
         AND probe_executor_id = $3`,
      [taskType, reasoningEffort, executorId],
    )
  } else if (
    input.status === 'failed' &&
    input.diagnostic_code === 'CODEX_PROCESS_FAILED' &&
    input.diagnostic_fingerprint &&
    taskType &&
    isAiTaskType(taskType)
  ) {
    const failures = await database.query<{ count: number }>(
      `SELECT count(*)::int AS count
       FROM agent_runs run
       JOIN pipeline_tasks task ON task.id = run.pipeline_task_id
       WHERE run.status = 'failed'
         AND run.diagnostic_code = 'CODEX_PROCESS_FAILED'
         AND run.diagnostic_fingerprint = $1
         AND task.task_type = $2
         AND run.reasoning_effort = $3
         AND run.completed_at >= now() - interval '15 minutes'`,
      [input.diagnostic_fingerprint, taskType, reasoningEffort],
    )
    const cooldownSeconds = codexCircuitCooldownSeconds(
      failures.rows[0]?.count ?? 0,
    )
    if (cooldownSeconds > 0) {
      await database.query(
        `INSERT INTO pipeline_ai_circuits (
           task_type,
           reasoning_effort,
           diagnostic_fingerprint,
           open_until,
           probe_executor_id
         )
         VALUES (
           $1,
           $2,
           $3,
           now() + make_interval(secs => $4::int),
           NULL
         )
         ON CONFLICT (task_type, reasoning_effort)
         DO UPDATE SET
           diagnostic_fingerprint = excluded.diagnostic_fingerprint,
           open_until = greatest(
             pipeline_ai_circuits.open_until,
             excluded.open_until
           ),
           probe_executor_id = NULL,
           updated_at = now()`,
        [
          taskType,
          reasoningEffort,
          input.diagnostic_fingerprint,
          cooldownSeconds,
        ],
      )
    }
  }
  return {
    agent_run_id: result.rows[0].id,
    status: input.status,
    tokens:
      input.input_tokens +
      input.output_tokens +
      input.reasoning_output_tokens
  }
}

export async function pausePipelineForSystemFailure(
  database: Database,
  input: z.infer<typeof pipelineSystemFailureSchema>,
  researcherId: string,
): Promise<Record<string, unknown>> {
  return withTransaction(database, async (client) => {
    const corroboration = await client.query<{ count: number }>(
      `SELECT count(*)::int AS count
       FROM (
         SELECT status, error_code
         FROM agent_runs
         WHERE executor_id = $1
           AND completed_at >= now() - interval '15 minutes'
         ORDER BY completed_at DESC
         LIMIT 3
       ) recent
       WHERE status = 'failed'
         AND error_code = 'AGENT_LAUNCH_FAILED'`,
      [researcherId],
    )
    if ((corroboration.rows[0]?.count ?? 0) < 3) {
      throw new Error('PIPELINE_SYSTEM_FAILURE_NOT_CORROBORATED')
    }
    await client.query(
      `UPDATE pipeline_settings
          SET enabled = false,
              paused_reason = $1,
              pause_requested_at = now(),
              control_generation = control_generation + 1,
              updated_at = now(),
              updated_by = $2
        WHERE singleton`,
      [
        `${input.failure_code}: ${input.failure_message}`,
        researcherId
      ],
    )
    await client.query(
      `INSERT INTO pipeline_events (
         stage, event_type, message, metadata
       )
       VALUES (
         'system',
         'paused',
         $1,
         jsonb_build_object('failure_code', $2::text)
       )`,
      [input.failure_message, input.failure_code],
    )
    await recordExecutorHeartbeat(
      client,
      researcherId,
      researcherId,
      {
        status: 'failed',
        failure_code: input.failure_code
      },
    )
    return {
      enabled: false,
      paused_reason: input.failure_code,
      system_failure: true
    }
  })
}

async function assertPipelineLease(
  client: DatabaseClient,
  taskId: string,
  leaseToken: string,
): Promise<PipelineTaskRow> {
  const task = await client.query<PipelineTaskRow>(
    `SELECT
       id,
       task_type,
       stage,
       payload,
       coverage_target_id,
       source_candidate_id,
       expert_task_id,
       knowledge_demand_id,
       requested_reasoning_effort,
       attempts
     FROM pipeline_tasks
     WHERE id = $1
       AND status = 'running'
       AND lease_until > now()
       AND lease_token_hash = $2
     FOR UPDATE`,
    [taskId, sha256(leaseToken)],
  )
  if (!task.rows[0]) throw new Error('PIPELINE_LEASE_INVALID')
  return task.rows[0]
}

export async function heartbeatPipelineTask(
  database: Database,
  config: AppConfig,
  taskId: string,
  leaseToken: string,
  researcherId = 'pipeline-coordinator',
  researcherInstanceId = researcherId,
): Promise<Record<string, unknown>> {
  return withTransaction(database, async (client) => {
    const task = await assertPipelineLease(client, taskId, leaseToken)
    const settings = await client.query<{ enabled: boolean }>(
      `SELECT enabled
       FROM pipeline_settings
       WHERE singleton
       FOR UPDATE`,
    )
    if (!settings.rows[0]?.enabled) {
      await client.query(
        `UPDATE pipeline_tasks
            SET status = 'queued',
                claim_owner = NULL,
                lease_token_hash = NULL,
                lease_until = NULL,
                heartbeat_at = NULL,
                failure_code = 'PIPELINE_PAUSED',
                failure_message =
                  'The Luna run was stopped because the pipeline was paused.',
                attempts = greatest(attempts - 1, 0),
                updated_at = now()
          WHERE id = $1`,
        [task.id],
      )
      if (task.task_type === 'fragment_analysis') {
        await client.query(
          `UPDATE source_fragments
              SET status = 'reserved',
                  updated_at = now()
            WHERE reservation_task_id = $1
              AND status = 'analyzing'`,
          [task.id],
        )
      }
      if (task.expert_task_id) {
        await client.query(
          `UPDATE expert_tasks
              SET status = 'queued',
                  claim_owner = NULL,
                  lease_token_hash = NULL,
                  lease_until = NULL,
                  heartbeat_at = NULL,
                  failure_code = NULL,
                  failure_message = NULL,
                  attempts = greatest(attempts - 1, 0),
                  completed_at = NULL,
                  updated_at = now()
            WHERE id = $1
              AND status IN ('claimed', 'researching')`,
          [task.expert_task_id],
        )
      }
      await recordExecutorHeartbeat(
        client,
        researcherId,
        researcherInstanceId,
        {
          status: 'paused',
          previous_task_id: task.id,
          previous_stage: task.stage
        },
      )
      await recordEvent(client, {
        taskId: task.id,
        sourceId: task.source_candidate_id,
        stage: task.stage,
        event: 'paused',
        message: 'The active Luna run was stopped and safely requeued.'
      })
      return {
        enabled: false,
        pipeline_task_id: taskId,
        status: 'queued',
        should_stop: true,
        reason: 'pipeline_paused'
      }
    }
    const leaseUntil = new Date(
      Date.now() + config.taskLeaseSeconds * 1_000,
    )
    await client.query(
      `UPDATE pipeline_tasks
          SET heartbeat_at = now(),
              lease_until = $3,
              updated_at = now()
        WHERE id = $1
          AND lease_token_hash = $2`,
      [taskId, sha256(leaseToken), leaseUntil.toISOString()],
    )
    if (task.expert_task_id) {
      await client.query(
        `UPDATE expert_tasks
            SET heartbeat_at = now(),
                lease_until = $3,
                updated_at = now()
          WHERE id = $1
            AND lease_token_hash = $2`,
        [
          task.expert_task_id,
          sha256(leaseToken),
          leaseUntil.toISOString()
        ],
      )
    }
    await recordExecutorHeartbeat(
      client,
      researcherId,
      researcherInstanceId,
      {
        status: 'running',
        task_id: task.id,
        task_type: task.task_type,
        stage: task.stage,
        lease_until: leaseUntil.toISOString()
      },
    )
    return {
      enabled: true,
      pipeline_task_id: taskId,
      status: 'running',
      lease_until: leaseUntil.toISOString(),
      should_stop: false
    }
  })
}

async function completeTask(
  client: DatabaseClient,
  task: PipelineTaskRow,
  result: Record<string, unknown>,
): Promise<void> {
  await client.query(
    `UPDATE pipeline_tasks
        SET status = 'completed',
            result = $2::jsonb,
            failure_code = NULL,
            failure_message = NULL,
            claim_owner = NULL,
            lease_token_hash = NULL,
            lease_until = NULL,
            completed_at = now(),
            updated_at = now()
      WHERE id = $1`,
    [task.id, JSON.stringify(result)],
  )
  await recordEvent(client, {
    taskId: task.id,
    sourceId: task.source_candidate_id,
    stage: task.stage,
    event: 'completed',
    message: `Completed ${task.task_type.replaceAll('_', ' ')} work.`,
    metadata: result
  })
}

export async function submitSourceDiscovery(
  database: Database,
  input: z.infer<typeof discoverySubmissionSchema>,
  researcherId: string,
): Promise<Record<string, unknown>> {
  const safeSources: z.infer<typeof discoverySourceSchema>[] = []
  for (const source of input.sources) {
    await assertSafeProvenanceUrl(source.canonical_url)
    safeSources.push(source)
  }
  const result = await withTransaction(database, async (client) => {
    const task = await assertPipelineLease(
      client,
      input.pipeline_task_id,
      input.lease_token,
    )
    if (
      !['source_discovery', 'source_refresh'].includes(task.task_type) ||
      !task.coverage_target_id
    ) {
      throw new Error('PIPELINE_TASK_TYPE_INVALID')
    }
    const insertedIds: string[] = []
    let duplicates = 0
    for (const source of safeSources) {
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO source_candidates (
           coverage_target_id,
           canonical_url,
           document_type,
           title,
           document_version,
           document_date,
           status,
           discovered_by,
           discovery_pipeline_task_id,
           knowledge_demand_id
         )
         VALUES ($1, $2, $3, $4, $5, $6, 'approved', $7, $8, $9)
         ON CONFLICT (canonical_url) DO NOTHING
         RETURNING id`,
        [
          task.coverage_target_id,
          source.canonical_url,
          source.document_type,
          source.title,
          source.document_version ?? null,
          source.document_date ?? null,
          researcherId,
          task.id,
          task.knowledge_demand_id
        ],
      )
      if (inserted.rows[0]) insertedIds.push(inserted.rows[0].id)
      else duplicates += 1
    }
    await client.query(
      `UPDATE coverage_targets
          SET status = CASE WHEN $2 > 0 THEN 'active' ELSE 'covered' END,
              coverage_percent = CASE
                WHEN $2 > 0 THEN greatest(coverage_percent, 5)
                ELSE coverage_percent
              END,
              next_check_at = now() + CASE
                WHEN $2 > 0 THEN interval '7 days'
                ELSE interval '24 hours'
              END,
              updated_at = now()
        WHERE id = $1`,
      [task.coverage_target_id, insertedIds.length],
    )
    if (insertedIds[0]) {
      await client.query(
        `UPDATE pipeline_settings
            SET active_source_id = $1,
                updated_at = now(),
                updated_by = $2
          WHERE singleton
            AND active_source_id IS NULL`,
        [insertedIds[0], researcherId],
      )
    }
    if (task.knowledge_demand_id) {
      await client.query(
        `UPDATE knowledge_demands
            SET status = CASE WHEN $2::uuid IS NULL
                  THEN 'unresolved'
                  ELSE 'acquiring'
                END,
                source_candidate_id = $2,
                discovery_task_id = NULL,
                last_error_code = CASE WHEN $2::uuid IS NULL
                  THEN 'OFFICIAL_SOURCE_NOT_FOUND'
                  ELSE NULL
                END,
                next_retry_at = CASE WHEN $2::uuid IS NULL
                  THEN now() + interval '15 minutes'
                  ELSE now()
                END,
                last_seen_at = now()
          WHERE id = $1`,
        [task.knowledge_demand_id, insertedIds[0] ?? null],
      )
    }
    const activeSource = await client.query<{
      active_source_id: string | null
    }>(
      `SELECT active_source_id
       FROM pipeline_settings
       WHERE singleton`,
    )
    const completion = {
      inserted_sources: insertedIds.length,
      duplicate_sources: duplicates,
      active_source_id: activeSource.rows[0]?.active_source_id ?? null,
      rejection_reason: input.rejection_reason ?? null
    }
    await recordPipelineTransition(client, {
      scope: 'source',
      fromStage: 'discover',
      toStage: 'acquire',
      count: insertedIds.length,
      kind: 'progress',
      taskId: task.id
    })
    await completeTask(client, task, completion)
    return completion
  })
  await ensurePipelineWork(database)
  return result
}

export async function submitCandidateAnalysis(
  database: Database,
  input: z.infer<typeof candidateAnalysisSubmissionSchema>,
): Promise<Record<string, unknown>> {
  const result = await withTransaction(database, async (client) => {
    const task = await assertPipelineLease(
      client,
      input.pipeline_task_id,
      input.lease_token,
    )
    if (task.task_type !== 'fragment_analysis') {
      throw new Error('PIPELINE_TASK_TYPE_INVALID')
    }
    const demandQuestion = task.knowledge_demand_id
      ? (await client.query<{ question: string }>(
          `SELECT question
           FROM knowledge_demands
           WHERE id = $1`,
          [task.knowledge_demand_id],
        )).rows[0]?.question ?? null
      : null
    const allowedFragmentIds = new Set(
      (
        Array.isArray(task.payload['fragments'])
          ? task.payload['fragments']
          : []
      ).flatMap((fragment) =>
        fragment &&
        typeof fragment === 'object' &&
        'id' in fragment &&
        typeof fragment.id === 'string'
          ? [fragment.id]
          : [],
        ),
    )
    const reservedFragments = await client.query<{
      id: string
      content_hash: string
    }>(
      `SELECT id, content_hash
       FROM source_fragments
       WHERE id = ANY($1::uuid[])
         AND reservation_task_id = $2
         AND status = 'analyzing'`,
      [[...allowedFragmentIds], task.id],
    )
    if (
      reservedFragments.rows.length !== allowedFragmentIds.size
    ) {
      throw new Error('PIPELINE_FRAGMENT_RESERVATION_INVALID')
    }
    const trustedFragmentHashes = new Map(
      reservedFragments.rows.map((fragment) => [
        fragment.id,
        fragment.content_hash
      ]),
    )
    const sourceIdentity = pipelineSourcePayloadSchema.parse(task.payload)
    const insertedIds: string[] = []
    let demandIrrelevantCandidates = 0
    for (const submission of input.candidates) {
      if (!allowedFragmentIds.has(submission.fragment_id)) {
        throw new Error('PIPELINE_FRAGMENT_NOT_IN_TASK')
      }
      const unboundCandidate = enforceKnowledgeRisk(
        pipelineCandidatePayloadSchema.parse(submission.candidate),
      )
      const evidence = unboundCandidate.provenance[0]!
      const candidate = {
        ...unboundCandidate,
        provenance: [{
          url: sourceIdentity.canonical_url,
          document_type: sourceIdentity.document_type,
          title: sourceIdentity.title.slice(0, 240),
          ...(sourceIdentity.document_version
            ? { document_version: sourceIdentity.document_version }
            : {}),
          ...(sourceIdentity.document_date
            ? { document_date: sourceIdentity.document_date }
            : {}),
          verified_at: unboundCandidate.last_verified_at,
          content_hash:
            trustedFragmentHashes.get(submission.fragment_id)!,
          evidence_fragment: evidence.evidence_fragment,
          evidence_role: 'primary' as const
        }]
      }
      if (
        demandQuestion &&
        !isRelevantToKnowledgeDemand(demandQuestion, [
          JSON.stringify(candidate)
        ])
      ) {
        demandIrrelevantCandidates += 1
        continue
      }
      const serialized = JSON.stringify(candidate)
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO knowledge_candidates (
           pipeline_task_id,
           source_fragment_id,
           stable_key,
           payload,
           content_hash,
           dangerous,
           confidence,
           quality_score
         )
         VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8)
         ON CONFLICT (content_hash) DO NOTHING
         RETURNING id`,
        [
          task.id,
          submission.fragment_id,
          candidate.stable_key,
          serialized,
          sha256Label(serialized),
          candidate.dangerous,
          candidate.confidence,
          candidate.quality_score
        ],
      )
      if (inserted.rows[0]) insertedIds.push(inserted.rows[0].id)
    }
    const submittedFragmentIds = [
      ...new Set(input.candidates.map((entry) => entry.fragment_id))
    ]
    const rejectedFragmentIds = [
      ...new Set(input.rejected_fragments.map((entry) => entry.fragment_id))
    ]
    for (const fragmentId of rejectedFragmentIds) {
      if (!allowedFragmentIds.has(fragmentId)) {
        throw new Error('PIPELINE_FRAGMENT_NOT_IN_TASK')
      }
    }
    const handledFragmentIds = new Set([
      ...submittedFragmentIds,
      ...rejectedFragmentIds
    ])
    if (
      handledFragmentIds.size !== allowedFragmentIds.size ||
      [...allowedFragmentIds].some((id) => !handledFragmentIds.has(id))
    ) {
      throw new Error('PIPELINE_ANALYSIS_INCOMPLETE')
    }
    await client.query(
      `UPDATE source_fragments
          SET status = 'analyzed',
              reservation_task_id = NULL,
              updated_at = now()
        WHERE id = ANY($1::uuid[])
          AND reservation_task_id = $2`,
      [submittedFragmentIds, task.id],
    )
    if (rejectedFragmentIds.length > 0) {
      await client.query(
        `UPDATE source_fragments
            SET status = 'rejected',
                reservation_task_id = NULL,
                updated_at = now()
          WHERE id = ANY($1::uuid[])
            AND reservation_task_id = $2`,
        [rejectedFragmentIds, task.id],
      )
    }
    const completion = {
      candidates_created: insertedIds.length,
      demand_irrelevant_candidates_ignored: demandIrrelevantCandidates,
      fragments_analyzed: submittedFragmentIds.length,
      fragments_without_candidates: rejectedFragmentIds.length,
      rejection_reasons: input.rejected_fragments.map((entry) => ({
        fragment_id: entry.fragment_id,
        reason: entry.reason
      }))
    }
    await recordPipelineTransition(client, {
      scope: 'record',
      fromStage: 'analyze',
      toStage: 'verify',
      count: insertedIds.length,
      kind: 'progress',
      taskId: task.id
    })
    await completeTask(client, task, completion)
    return completion
  })
  await ensurePipelineWork(database)
  return result
}

export function getDeterministicRiskDisposition(
  candidate: z.infer<typeof pipelineCandidatePayloadSchema>,
): {
  decision: 'conflict' | 'deep_review'
  finding: string
} | null {
  const normalized = enforceKnowledgeRisk(candidate)

  // This is deliberately the same non-negotiable safety invariant enforced by
  // createKnowledgeRevision at publication time.  Catch it before a candidate
  // becomes Ready so the mechanical publisher never spends a cycle discovering
  // that an otherwise "verified" dangerous procedure is incomplete.
  if (normalized.dangerous && normalized.rollback.length === 0) {
    return {
      decision: 'deep_review',
      finding:
        'Dangerous candidates require an explicit rollback procedure before they can be verified.'
    }
  }
  return null
}

/**
 * Publication retains its own invariant, but the same structural and Domain
 * Pack checks belong in Verify too. Discovering a malformed payload only at
 * publication wastes a release slot and sends an otherwise repairable record
 * through an avoidable extra Deep Review cycle.
 */
export function getDeterministicPublicationPreflightDisposition(
  unparsedCandidate: unknown,
): {
  decision: 'deep_review'
  finding: string
} | null {
  try {
    const candidate = enforceKnowledgeRisk(
      candidateKnowledgeSchema.parse(unparsedCandidate),
    )
    const networkDomainPack = getNetworkDomainPack()
    const packCandidate = networkDomainPack.candidateSchema.parse(candidate)
    const packValidation = networkDomainPack.validateCandidate(packCandidate)
    if (!packValidation.valid) {
      return {
        decision: 'deep_review',
        finding:
          'Deterministic publication preflight rejected the Domain Pack payload.',
      }
    }
    enforceCoreCandidatePolicy(
      networkDomainPack.toCoreCandidate(packCandidate),
    )
    return null
  } catch {
    return {
      decision: 'deep_review',
      finding:
        'Deterministic publication preflight rejected the candidate payload.',
    }
  }
}

async function getDeterministicCandidateDisposition(
  client: DatabaseClient,
  unparsedCandidate: unknown,
): Promise<{
  decision: 'conflict' | 'deep_review'
  finding: string
} | null> {
  const candidate = pipelineCandidatePayloadSchema.parse(unparsedCandidate)
  const riskDisposition = getDeterministicRiskDisposition(candidate)
  if (riskDisposition) return riskDisposition

  const publicationPreflight =
    getDeterministicPublicationPreflightDisposition(candidate)
  if (publicationPreflight) return publicationPreflight

  try {
    if (candidate.version_min) normalizeVendorVersion(candidate.version_min)
    if (candidate.version_max) normalizeVendorVersion(candidate.version_max)
  } catch {
    return {
      decision: 'deep_review',
      finding:
        'Deterministic version validation could not normalize the declared scope.'
    }
  }

  const context = await client.query<{
    vendor_exists: boolean
    operating_system_exists: boolean
    platform_exists: boolean
    existing_kind: string | null
  }>(
    `SELECT
       EXISTS (
         SELECT 1 FROM vendors v
         WHERE v.slug = $1
       ) AS vendor_exists,
       EXISTS (
         SELECT 1
         FROM operating_systems os
         JOIN vendors v ON v.id = os.vendor_id
         WHERE v.slug = $1 AND os.slug = $2
       ) AS operating_system_exists,
       (
         $3::text IS NULL OR EXISTS (
           SELECT 1
           FROM platforms p
           JOIN vendors v ON v.id = p.vendor_id
           WHERE v.slug = $1 AND p.slug = $3
         )
       ) AS platform_exists,
       (
         SELECT ki.kind
         FROM knowledge_items ki
         WHERE ki.stable_key = $4
       ) AS existing_kind`,
    [
      candidate.vendor_slug,
      candidate.operating_system_slug,
      candidate.platform_slug ?? null,
      candidate.stable_key
    ],
  )
  const state = context.rows[0]
  if (!state?.vendor_exists) {
    return {
      decision: 'deep_review',
      finding:
        'Deterministic context validation could not resolve the declared vendor.'
    }
  }
  if (!state.operating_system_exists) {
    return {
      decision: 'deep_review',
      finding:
        'Deterministic context validation could not resolve the declared operating system.'
    }
  }
  if (!state.platform_exists) {
    return {
      decision: 'deep_review',
      finding:
        'Deterministic context validation could not resolve the declared platform.'
    }
  }
  if (state.existing_kind && state.existing_kind !== candidate.kind) {
    return {
      decision: 'conflict',
      finding:
        'The stable key already exists with a different knowledge kind.'
    }
  }
  return null
}

export async function submitCandidateVerification(
  database: Database,
  config: AppConfig,
  input: z.infer<typeof candidateVerificationSubmissionSchema>,
  researcherId: string,
): Promise<Record<string, unknown>> {
  const result = await withTransaction(database, async (client) => {
    const task = await assertPipelineLease(
      client,
      input.pipeline_task_id,
      input.lease_token,
    )
    if (task.task_type !== 'candidate_verification') {
      throw new Error('PIPELINE_TASK_TYPE_INVALID')
    }
    const allowedCandidateIds = new Set(
      (
        Array.isArray(task.payload['candidates'])
          ? task.payload['candidates']
          : []
      ).flatMap((candidate) =>
        candidate &&
        typeof candidate === 'object' &&
        'id' in candidate &&
        typeof candidate.id === 'string'
          ? [candidate.id]
          : [],
      ),
    )
    const counts = {
      verified: 0,
      rejected: 0,
      conflict: 0,
      deep_review: 0
    }
    for (const decision of input.decisions) {
      if (!allowedCandidateIds.has(decision.candidate_id)) {
        throw new Error('PIPELINE_CANDIDATE_NOT_IN_TASK')
      }
      const candidate = await client.query<{
        dangerous: boolean
        payload: unknown
      }>(
        `SELECT dangerous, payload
         FROM knowledge_candidates
         WHERE id = $1
           AND verification_task_id = $2
           AND status = 'analyzed'
         FOR UPDATE`,
        [decision.candidate_id, task.id],
      )
      if (!candidate.rows[0]) {
        throw new Error('PIPELINE_CANDIDATE_RESERVATION_INVALID')
      }
      const threshold = candidate.rows[0].dangerous
        ? config.dangerousAutoPublishConfidence
        : config.autoPublishConfidence
      const deterministicDisposition =
        decision.decision === 'verified'
          ? await getDeterministicCandidateDisposition(
              client,
              candidate.rows[0].payload,
            )
          : null
      const finalDecision = deterministicDisposition?.decision ?? (
        decision.decision === 'verified' &&
        (
          decision.confidence < threshold ||
          decision.quality_score < 0.85
        )
          ? 'deep_review'
          : decision.decision
      )
      counts[finalDecision] += 1
      await client.query(
        `INSERT INTO candidate_verifications (
           knowledge_candidate_id,
           pipeline_task_id,
           decision,
           confidence,
           quality_score,
           findings,
           verified_by,
           review_type
         )
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, 'standard')`,
        [
          decision.candidate_id,
          task.id,
          finalDecision,
          decision.confidence,
          decision.quality_score,
          JSON.stringify([
            ...decision.findings,
            ...(
              deterministicDisposition
                ? [deterministicDisposition.finding]
                : []
            )
          ]),
          researcherId
        ],
      )
      await client.query(
        `UPDATE knowledge_candidates
            SET status = $2,
                confidence = $3,
                quality_score = $4,
                verification_task_id = NULL,
                resolution_reason = CASE
                  WHEN $2 = 'deep_review'
                  THEN $6
                  ELSE resolution_reason
                END,
                resolution_code = CASE
                  WHEN $2 = 'deep_review'
                  THEN CASE
                    WHEN $7::boolean THEN 'context_validation'
                    ELSE 'standard_unresolved'
                  END
                  ELSE resolution_code
                END,
                next_review_at = CASE
                  WHEN $2 = 'deep_review' THEN now()
                  ELSE next_review_at
                END,
                updated_at = now()
          WHERE id = $1
            AND verification_task_id = $5`,
        [
          decision.candidate_id,
          finalDecision,
          decision.confidence,
          decision.quality_score,
          task.id,
          deterministicDisposition?.finding ??
            decision.findings.join('; ').slice(0, 2_000) ??
            'Standard verification requested automatic deep review.',
          Boolean(deterministicDisposition)
        ],
      )
    }
    const omitted = [...allowedCandidateIds].filter(
      (id) => !input.decisions.some((entry) => entry.candidate_id === id),
    )
    if (omitted.length > 0) {
      await client.query(
        `UPDATE knowledge_candidates
            SET status = 'deep_review',
                verification_task_id = NULL,
                resolution_code = 'verifier_omitted',
                resolution_reason = 'Standard verifier omitted the leased candidate.',
                next_review_at = now(),
                updated_at = now()
          WHERE id = ANY($1::uuid[])
            AND verification_task_id = $2`,
        [omitted, task.id],
      )
      counts.deep_review += omitted.length
    }
    await client.query(
      `UPDATE source_fragments sf
          SET status = 'verified',
              updated_at = now()
        WHERE sf.id IN (
          SELECT DISTINCT kc.source_fragment_id
          FROM knowledge_candidates kc
          WHERE kc.id = ANY($1::uuid[])
            AND kc.source_fragment_id IS NOT NULL
            AND kc.status = 'verified'
        )
          AND NOT EXISTS (
            SELECT 1
            FROM knowledge_candidates outstanding
            WHERE outstanding.source_fragment_id = sf.id
              AND outstanding.status = 'analyzed'
          )`,
      [[...allowedCandidateIds]],
    )
    await recordPipelineTransitions(client, [
      {
        scope: 'record',
        fromStage: 'verify',
        toStage: 'ready',
        count: counts.verified,
        kind: 'progress',
        taskId: task.id
      },
      {
        scope: 'record',
        fromStage: 'verify',
        toStage: 'deep_low',
        count: counts.deep_review,
        kind: 'escalation',
        taskId: task.id
      },
      {
        scope: 'record',
        fromStage: 'verify',
        toStage: 'rejected',
        count: counts.rejected,
        kind: 'terminal',
        taskId: task.id
      },
      {
        scope: 'record',
        fromStage: 'verify',
        toStage: 'conflict',
        count: counts.conflict,
        kind: 'terminal',
        taskId: task.id
      }
    ])
    await completeTask(client, task, counts)
    return counts
  })
  await ensurePipelineWork(database)
  return result
}

export async function submitCandidateDeepReview(
  database: Database,
  config: AppConfig,
  input: z.infer<typeof candidateDeepReviewSubmissionSchema>,
  researcherId: string,
): Promise<Record<string, unknown>> {
  const result = await withTransaction(database, async (client) => {
    const task = await assertPipelineLease(
      client,
      input.pipeline_task_id,
      input.lease_token,
    )
    if (task.task_type !== 'candidate_deep_review') {
      throw new Error('PIPELINE_TASK_TYPE_INVALID')
    }
    const reviewMode = deepReviewModeFromTask(task)
    const reviewPass = reviewMode === 'medium' ? 'medium' : 'low'
    const reviewType =
      reviewMode === 'low' ? 'deep_low' : 'deep_medium'
    const allowedCandidateIds = new Set(
      (
        Array.isArray(task.payload['candidates'])
          ? task.payload['candidates']
          : []
      ).flatMap((candidate) =>
        candidate &&
        typeof candidate === 'object' &&
        'id' in candidate &&
        typeof candidate.id === 'string'
          ? [candidate.id]
          : [],
      ),
    )
    const counts = {
      verified: 0,
      rejected: 0,
      conflict: 0,
      escalated_to_medium: 0,
      quarantined: 0,
      manual_exception: 0
    }
    const configuredBatchLimit = Number(task.payload['batch_limit'])
    const taskBatchLimit = Number.isInteger(configuredBatchLimit)
      ? Math.min(20, Math.max(1, configuredBatchLimit))
      : Math.min(20, Math.max(1, allowedCandidateIds.size))
    let cohortResolutionCode = typeof task.payload['resolution_code'] ===
      'string'
      ? task.payload['resolution_code']
      : null
    for (const decision of input.decisions) {
      if (!allowedCandidateIds.has(decision.candidate_id)) {
        throw new Error('PIPELINE_CANDIDATE_NOT_IN_TASK')
      }
      const selected = await client.query<{
        payload: unknown
        dangerous: boolean
        resolution_reason: string | null
        resolution_code: string | null
      }>(
        `SELECT payload, dangerous, resolution_reason, resolution_code
         FROM knowledge_candidates
         WHERE id = $1
           AND deep_review_task_id = $2
           AND status = 'deep_review'
         FOR UPDATE`,
        [decision.candidate_id, task.id],
      )
      const row = selected.rows[0]
      if (!row) {
        throw new Error('PIPELINE_CANDIDATE_RESERVATION_INVALID')
      }

      // Tasks created before batch metadata was added remain valid after an
      // application rollout. Read the server-owned candidate code as a
      // compatibility fallback rather than silently skipping recovery.
      cohortResolutionCode ??= row.resolution_code

      let candidatePayload = row.payload
      let repairedPayloadHash: string | null = null
      let validationFinding: string | null = null
      if (decision.repaired_candidate) {
        try {
          const repaired = applyDeepReviewRepair(
            row.payload,
            decision.repaired_candidate as Record<string, unknown>,
          )
          candidatePayload = repaired
          repairedPayloadHash = sha256Label(JSON.stringify(repaired))
        } catch {
          validationFinding =
            'The repaired candidate did not satisfy the Domain Pack schema or risk contract.'
        }
      }

      let requestedDecision = decision.decision
      if (requestedDecision === 'verified' && !validationFinding) {
        const deterministic = await getDeterministicCandidateDisposition(
          client,
          candidatePayload,
        )
        if (deterministic?.decision === 'conflict') {
          requestedDecision = 'conflict'
          validationFinding = deterministic.finding
        } else if (deterministic) {
          requestedDecision = 'unresolved'
          validationFinding = deterministic.finding
        }
      }
      const parsedCandidate = pipelineCandidatePayloadSchema.safeParse(
        candidatePayload,
      )
      const dangerous = parsedCandidate.success
        ? enforceKnowledgeRisk(parsedCandidate.data).dangerous
        : row.dangerous
      const threshold = dangerous
        ? config.dangerousAutoPublishConfidence
        : config.autoPublishConfidence
      if (
        requestedDecision === 'verified' &&
        (
          !parsedCandidate.success ||
          validationFinding ||
          decision.confidence < threshold ||
          decision.quality_score < 0.85
        )
      ) {
        requestedDecision = 'unresolved'
      }

      let finalStatus:
        | 'verified'
        | 'rejected'
        | 'conflict'
        | 'deep_review'
        | 'quarantined'
        | 'manual_exception'
      if (requestedDecision !== 'unresolved') {
        finalStatus = requestedDecision
      } else if (reviewMode === 'fallback_low') {
        // The fallback is only created after the same Medium batch exhausted
        // repeated platform retries. A valid low-result may verify a claim,
        // but an unresolved result is conservatively terminal rather than
        // returning to the same failing Medium loop.
        finalStatus = 'rejected'
      } else if (reviewPass === 'low') {
        finalStatus = automaticUnresolvedDisposition({
          reviewPass,
          dangerous,
          confidence: decision.confidence,
          todayManualExceptions: 0,
          manualExceptionDailyCap: 0
        })
      } else {
        const todayExceptions = await client.query<{ count: number }>(
          `SELECT count(*)::int AS count
           FROM knowledge_candidates
           WHERE status = 'manual_exception'
             AND updated_at >= date_trunc('day', now())`,
        )
        const cap = await client.query<{ cap: number }>(
          `SELECT manual_exception_daily_cap AS cap
           FROM pipeline_settings
           WHERE singleton`,
        )
        finalStatus = automaticUnresolvedDisposition({
          reviewPass,
          dangerous,
          confidence: decision.confidence,
          todayManualExceptions: todayExceptions.rows[0]?.count ?? 0,
          manualExceptionDailyCap: cap.rows[0]?.cap ?? 3
        })
      }

      const findingText = [
        ...decision.findings,
        ...(validationFinding ? [validationFinding] : [])
      ]
      await client.query(
        `INSERT INTO candidate_verifications (
           knowledge_candidate_id,
           pipeline_task_id,
           decision,
           confidence,
           quality_score,
           findings,
           verified_by,
           review_type,
           repaired_payload_hash
         )
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9)`,
        [
          decision.candidate_id,
          task.id,
          finalStatus,
          decision.confidence,
          decision.quality_score,
          JSON.stringify(findingText),
          researcherId,
          reviewType,
          repairedPayloadHash
        ],
      )
      const serializedPayload = JSON.stringify(candidatePayload)
      await client.query(
        `UPDATE knowledge_candidates
            SET status = $2,
                payload = $3::jsonb,
                dangerous = $4,
                confidence = $5,
                quality_score = $6,
                deep_review_task_id = NULL,
                resolution_attempts = resolution_attempts + 1,
                resolution_reason = $7,
                resolution_code = coalesce(
                  resolution_code,
                  'deep_unresolved'
                ),
                next_review_at = CASE
                  WHEN $2 = 'deep_review'
                  THEN now()
                  ELSE NULL
                END,
                deep_review_batch_limit = 20,
                technical_retry_count = 0,
                last_technical_failure_code = NULL,
                updated_at = now()
          WHERE id = $1
            AND deep_review_task_id = $8`,
        [
          decision.candidate_id,
          finalStatus,
          serializedPayload,
          dangerous,
          decision.confidence,
          decision.quality_score,
          findingText.join('; ').slice(0, 4_000) ||
            row.resolution_reason ||
            'Deep review could not resolve the candidate.',
          task.id
        ],
      )
      if (finalStatus === 'deep_review') {
        counts.escalated_to_medium += 1
      } else {
        counts[finalStatus] += 1
      }
    }

    const omitted = [...allowedCandidateIds].filter(
      (id) => !input.decisions.some(
        (decision) => decision.candidate_id === id,
      ),
    )
    if (omitted.length > 0) {
      await client.query(
        `UPDATE knowledge_candidates
            SET status = 'deep_review',
                deep_review_task_id = NULL,
                resolution_reason =
                  'Deep reviewer omitted the leased candidate.',
                resolution_code = 'deep_reviewer_omitted',
                next_review_at = now(),
                deep_review_batch_limit =
                  greatest(1, deep_review_batch_limit / 2),
                technical_retry_count =
                  least(20, technical_retry_count + 1),
                last_technical_failure_code = 'deep_reviewer_omitted',
                updated_at = now()
          WHERE id = ANY($1::uuid[])
            AND deep_review_task_id = $2`,
        [omitted, task.id],
      )
      if (reviewMode === 'low') {
        counts.escalated_to_medium += omitted.length
      }
    }
    if (omitted.length === 0) {
      const recoveredBatchLimit = nextDeepReviewBatchLimitAfterCleanPass(
        taskBatchLimit,
        allowedCandidateIds.size,
      )
      if (recoveredBatchLimit > taskBatchLimit) {
        await client.query(
          `UPDATE knowledge_candidates candidate
              SET deep_review_batch_limit = $1,
                  updated_at = now()
             FROM pipeline_tasks candidate_task
            WHERE candidate.pipeline_task_id = candidate_task.id
              AND candidate_task.source_candidate_id IS NOT DISTINCT FROM $2::uuid
              AND candidate.status IN ('deep_review', 'quarantined')
              AND candidate.deep_review_task_id IS NULL
              AND candidate.deep_review_batch_limit = $3
              AND coalesce(candidate.resolution_code, 'unspecified') =
                  coalesce($4::text, 'unspecified')
              AND (
                CASE WHEN $5 = 'low'
                  THEN candidate.resolution_attempts = 0
                ELSE candidate.resolution_attempts > 0
                END
              )`,
          [
            recoveredBatchLimit,
            task.source_candidate_id,
            taskBatchLimit,
            cohortResolutionCode,
            reviewMode,
          ],
        )
      }
    }
    if (task.source_candidate_id && counts.verified > 0) {
      await client.query(
        `UPDATE source_candidates
            SET status = 'verifying',
                completed_at = NULL,
                updated_at = now()
          WHERE id = $1
            AND status = 'completed_with_exceptions'`,
        [task.source_candidate_id],
      )
    }
    const fromStage = reviewMode === 'low' ? 'deep_low' : 'deep_medium'
    await recordPipelineTransitions(client, [
      {
        scope: 'record',
        fromStage,
        toStage: 'ready',
        count: counts.verified,
        kind: 'progress',
        taskId: task.id
      },
      {
        scope: 'record',
        fromStage,
        toStage: 'deep_medium',
        count: reviewMode === 'low' ? counts.escalated_to_medium : 0,
        kind: 'escalation',
        taskId: task.id
      },
      {
        scope: 'record',
        fromStage,
        toStage: 'rejected',
        count: counts.rejected,
        kind: 'terminal',
        taskId: task.id
      },
      {
        scope: 'record',
        fromStage,
        toStage: 'conflict',
        count: counts.conflict,
        kind: 'terminal',
        taskId: task.id
      },
      {
        scope: 'record',
        fromStage,
        toStage: 'quarantine',
        count: counts.quarantined,
        kind: 'terminal',
        taskId: task.id
      },
      {
        scope: 'record',
        fromStage,
        toStage: 'manual_exception',
        count: counts.manual_exception,
        kind: 'terminal',
        taskId: task.id
      }
    ])
    await completeTask(client, task, counts)
    return counts
  })
  await ensurePipelineWork(database)
  return result
}

export async function failPipelineTask(
  database: Database,
  input: z.infer<typeof pipelineFailureSchema>,
): Promise<Record<string, unknown>> {
  const result = await withTransaction(database, async (client) => {
    const task = await assertPipelineLease(
      client,
      input.pipeline_task_id,
      input.lease_token,
    )
    const terminalFailureCodes = new Set([
      'EXPERT_NO_VERIFIED_ANSWER',
      'PIPELINE_EXPLICIT_REJECTION',
      'SOURCE_POLICY_REJECTED',
      // These responses identify a permanently unavailable document. Retrying
      // the exact URL only burns a mechanical worker slot; the scheduler can
      // immediately select a replacement official source instead.
      'SOURCE_HTTP_404',
      'SOURCE_HTTP_410'
    ])
    const retrying =
      (task.attempts ?? 1) < 5 &&
      !terminalFailureCodes.has(input.failure_code)
    const demandDisposition = demandFailureDisposition({
      hasDemand: task.knowledge_demand_id !== null,
      taskType: task.task_type,
      retrying
    })
    const reduceDeepReviewBatch =
      task.task_type === 'candidate_deep_review' &&
      shouldReduceDeepReviewBatchOnFailure(
        input.failure_code,
        input.failure_message,
      )
    const exhaustedDeepReviewFallback =
      task.task_type === 'candidate_deep_review' &&
      deepReviewModeFromTask(task) === 'fallback_low' &&
      !retrying
    await client.query(
      `UPDATE pipeline_tasks
          SET status = $4,
              failure_code = $2,
              failure_message = $3,
              claim_owner = NULL,
              lease_token_hash = NULL,
              lease_until = NULL,
              heartbeat_at = NULL,
              completed_at = CASE
                WHEN $4 = 'failed' THEN now()
                ELSE NULL
              END,
              available_at = CASE
                WHEN $4 = 'queued'
                  THEN now() + make_interval(
                    secs => least(60, greatest(2, attempts * attempts))
                  )
                ELSE available_at
              END,
              updated_at = now()
        WHERE id = $1`,
      [
        task.id,
        input.failure_code,
        input.failure_message,
        retrying ? 'queued' : 'failed'
      ],
    )
    if (task.knowledge_demand_id) {
      await client.query(
        `UPDATE knowledge_demands
            SET status = CASE
                  WHEN $7 = 'keep_processing' THEN 'processing'
                  WHEN NOT $2 THEN 'failed'
                  WHEN $5 = ANY($6::text[]) THEN 'discovering'
                  WHEN $5 = 'source_acquisition' THEN 'acquiring'
                  ELSE 'processing'
                END,
                discovery_task_id = CASE
                  WHEN $7 = 'restart_discovery' THEN NULL
                  WHEN $5 = ANY($6::text[]) AND $2 THEN $3
                  WHEN $5 = ANY($6::text[]) THEN NULL
                  ELSE discovery_task_id
                END,
                last_error_code = $4,
                next_retry_at = CASE
                  WHEN $7 IN ('keep_processing', 'restart_discovery')
                    THEN now()
                  WHEN $2
                  THEN now()
                  ELSE now() + interval '15 minutes'
                END,
                last_seen_at = now()
          WHERE id = $1`,
        [
          task.knowledge_demand_id,
          retrying,
          task.id,
          input.failure_code,
          task.task_type,
          ['source_discovery', 'source_refresh'],
          demandDisposition
        ],
      )
    }
    if (task.task_type === 'candidate_publication' && !retrying) {
      await client.query(
        `UPDATE knowledge_candidates
            SET publication_task_id = NULL,
                updated_at = now()
          WHERE publication_task_id = $1
            AND status = 'verified'`,
        [task.id],
      )
    }
    if (task.expert_task_id) {
      await client.query(
        `UPDATE expert_tasks
            SET status = $4,
                failure_code = $2,
                failure_message = $3,
                claim_owner = NULL,
                lease_token_hash = NULL,
                lease_until = NULL,
                heartbeat_at = NULL,
                completed_at = CASE
                  WHEN $4 = 'failed' THEN now()
                  ELSE NULL
                END,
                updated_at = now()
          WHERE id = $1
            AND status IN ('claimed', 'researching')`,
        [
          task.expert_task_id,
          input.failure_code,
          input.failure_message,
          retrying ? 'queued' : 'failed'
        ],
      )
    }
    if (task.source_candidate_id) {
      const nonBlockingAiStage = nonBlockingAiTaskTypes.includes(
        task.task_type,
      )
      if (task.task_type === 'fragment_analysis') {
        await client.query(
          `UPDATE source_fragments
              SET status = CASE WHEN $2 THEN 'reserved' ELSE 'failed' END,
                  reservation_task_id = CASE WHEN $2 THEN $1 ELSE NULL END,
                  updated_at = now()
            WHERE reservation_task_id = $1
              AND status IN ('reserved', 'analyzing')`,
          [task.id, retrying],
        )
      }
      if (task.task_type === 'candidate_verification' && !retrying) {
        await client.query(
          `UPDATE knowledge_candidates
              SET status = 'deep_review',
                  verification_task_id = NULL,
                  resolution_code = 'verification_attempts_exhausted',
                  resolution_reason =
                    'Standard verification exhausted automatic retries.',
                  next_review_at = now(),
                  updated_at = now()
            WHERE verification_task_id = $1
              AND status = 'analyzed'`,
          [task.id],
        )
      }
      if (task.task_type === 'candidate_deep_review') {
        await client.query(
          `UPDATE knowledge_candidates
              SET status = 'deep_review',
                  deep_review_task_id = CASE WHEN $2 THEN $1 ELSE NULL END,
                  resolution_code = CASE WHEN $6::boolean
                    THEN 'deep_medium_fallback_unavailable'
                    ELSE coalesce(
                      resolution_code,
                      'deep_process_failure'
                    )
                  END,
                  resolution_reason = $3,
                  next_review_at = CASE WHEN $2 THEN now()
                    WHEN $6::boolean THEN now() + interval '24 hours'
                    ELSE now() + least(
                      interval '5 minutes',
                      interval '15 seconds' *
                        power(2, least(4, technical_retry_count))
                    )
                  END,
                  deep_review_batch_limit =
                    CASE WHEN $4::boolean
                      THEN greatest(1, deep_review_batch_limit / 2)
                      ELSE deep_review_batch_limit
                    END,
                technical_retry_count =
                  least(20, technical_retry_count + 1),
                last_technical_failure_code = CASE WHEN $6::boolean
                  THEN 'DEEP_MEDIUM_FALLBACK_UNAVAILABLE'
                  ELSE $5
                END,
                updated_at = now()
            WHERE deep_review_task_id = $1`,
          [
            task.id,
            retrying,
            input.failure_message,
            reduceDeepReviewBatch,
            input.failure_code,
            exhaustedDeepReviewFallback
          ],
        )
      }
      if (nonBlockingAiStage) {
        await client.query(
          `UPDATE source_candidates
              SET status = 'analyzing',
                  failure_code = $2,
                  failure_message = $3,
                  updated_at = now()
            WHERE id = $1`,
          [
            task.source_candidate_id,
            input.failure_code,
            input.failure_message
          ],
        )
      } else if (retrying) {
        const retrySourceStatus: Partial<
          Record<PipelineTaskRow['task_type'], string>
        > = {
          source_acquisition: 'approved',
          source_conversion: 'acquired',
          source_chunking: 'converted',
          fragment_analysis: 'analyzing',
          candidate_verification: 'verifying',
          candidate_deep_review: 'verifying',
          source_publication: 'publishing',
          source_refresh: 'approved'
        }
        await client.query(
          `UPDATE source_candidates
              SET status = $2,
                  failure_code = $3,
                  failure_message = $4,
                  updated_at = now()
            WHERE id = $1`,
          [
            task.source_candidate_id,
            retrySourceStatus[task.task_type] ?? 'approved',
            input.failure_code,
            input.failure_message
          ],
        )
      } else {
        await client.query(
          `UPDATE source_candidates
              SET status = 'failed',
                  failure_code = $2,
                  failure_message = $3,
                  updated_at = now()
            WHERE id = $1`,
          [
            task.source_candidate_id,
            input.failure_code,
            input.failure_message
          ],
        )
        await client.query(
          `UPDATE pipeline_settings
              SET active_source_id = NULL,
                  updated_at = now(),
                  updated_by = 'pipeline-failure'
            WHERE singleton
              AND active_source_id = $1`,
          [task.source_candidate_id],
        )
      }
    }
    if (
      !retrying &&
      task.coverage_target_id &&
      ![
        'fragment_analysis',
        'candidate_verification',
        'candidate_deep_review'
      ].includes(task.task_type)
    ) {
      await client.query(
        `UPDATE coverage_targets
            SET status = 'failed',
                next_check_at = now(),
                updated_at = now()
          WHERE id = $1`,
        [task.coverage_target_id],
      )
    }
    await recordEvent(client, {
      taskId: task.id,
      sourceId: task.source_candidate_id,
      stage: task.stage,
      event: retrying ? 'retried' : 'failed',
      message: retrying
        ? `Stage returned to the queue: ${input.failure_message}`
        : input.failure_message,
      metadata: { failure_code: input.failure_code }
    })
    return {
      pipeline_task_id: task.id,
      status: retrying ? 'queued' : 'failed',
      retrying,
      failure_code: input.failure_code
    }
  })
  await ensurePipelineWork(database)
  return result
}
