import { z } from 'zod'

import { sha256Label } from '../crypto.js'
import type { Database, DatabaseClient } from '../db.js'
import type { InternalResolvedContext } from './context.js'
import { resolveNetworkContext } from './context.js'
import {
  filterActionableKnowledge,
  searchKnowledge
} from './knowledge.js'
import {
  decomposeNetworkQuestion,
  normalizeTopicSlug,
  type NetworkQuestionPart
} from './network-intent.js'
import type { PublicKnowledge } from './schemas.js'

export const answerStatusSchema = z.enum(['complete', 'partial', 'unknown'])

export const demandFailureClassSchema = z.enum([
  'context_resolution',
  'retrieval_relevance',
  'missing_knowledge',
  'version_scope',
  'incomplete_workflow',
  'tool_error'
])

export const demandDiagnosisActionSchema = z.enum([
  'reuse_existing',
  'add_alias',
  'targeted_discovery',
  'repair_search',
  'explicit_reject'
])

const diagnosticContextSchema = z.strictObject({
  vendor: z.string().trim().min(1).max(240).nullable(),
  model: z.string().trim().min(1).max(240).nullable(),
  operating_system: z.string().trim().min(1).max(240),
  version: z.string().trim().min(1).max(64).nullable(),
  runtime_mode: z.enum([
    'normal', 'rescue', 'installer', 'update', 'uninstall', 'recovery',
    'diagnostic'
  ]).nullable(),
  shell_environment: z.string().trim().min(1).max(120).nullable()
})

const diagnosisPartSchema = z.strictObject({
  capability: z.string().regex(/^[a-z][a-z0-9-]{1,62}$/),
  label: z.string().trim().min(2).max(120),
  status: z.enum(['covered', 'partial', 'missing', 'misrouted']),
  explanation: z.string().trim().min(8).max(600),
  search_terms: z.array(z.string().trim().min(2).max(120)).max(12)
})

export const demandDiagnosisAgentArtifactSchema = z.strictObject({
  failure_class: demandFailureClassSchema,
  answer_status: answerStatusSchema,
  canonical_context: diagnosticContextSchema,
  subquestions: z.array(diagnosisPartSchema).min(1).max(12),
  existing_coverage_summary: z.string().trim().min(8).max(1_000),
  missing_capabilities: z.array(
    z.string().regex(/^[a-z][a-z0-9-]{1,62}$/),
  ).max(12),
  search_expansions: z.array(z.string().trim().min(2).max(160)).max(20),
  document_roles: z.array(z.enum([
    'commands',
    'configuration',
    'diagnostics',
    'upgrades',
    'security_advisories',
    'release_notes'
  ])).min(1).max(6),
  recommended_action: demandDiagnosisActionSchema,
  reasoning_summary: z.string().trim().min(12).max(1_500)
})

export type DemandDiagnosisArtifact = z.infer<
  typeof demandDiagnosisAgentArtifactSchema
>

export type KnowledgeCoverage = {
  answers: PublicKnowledge[]
  answerStatus: z.infer<typeof answerStatusSchema>
  coverage: Array<{
    capability: string
    label: string
    status: 'covered' | 'missing'
    answer_refs: string[]
  }>
}

function uniqueAnswers(answers: PublicKnowledge[], limit: number): PublicKnowledge[] {
  return [...new Map(answers.map((answer) => [answer.revision_ref, answer])).values()]
    .slice(0, limit)
}

export async function searchKnowledgeWithCoverage(input: {
  database: Database
  question: string
  context: InternalResolvedContext
  limit: number
  kind?: PublicKnowledge['kind'] | PublicKnowledge['kind'][]
  requireAction?: boolean
}): Promise<KnowledgeCoverage> {
  const parts = decomposeNetworkQuestion(input.question)
  const result = await Promise.all(parts.map(async (part) => {
    const raw = await searchKnowledge(
      input.database,
      part.query,
      input.context,
      input.limit,
      input.kind,
    )
    const partRequiresAction = input.requireAction === true && ![
      'arp-diagnostics',
      'interface-counters'
    ].includes(part.capability)
    const answers = filterActionableKnowledge(
      part.query,
      raw,
      { requireAction: partRequiresAction },
    )
    return { part, answers }
  }))
  const answers = uniqueAnswers([
    ...result.flatMap((entry) => entry.answers.slice(0, 1)),
    ...result.flatMap((entry) => entry.answers.slice(1))
  ], Math.min(20, Math.max(input.limit, parts.length)))
  const covered = result.filter((entry) => entry.answers.length > 0).length
  return {
    answers,
    answerStatus:
      covered === parts.length
        ? 'complete'
        : covered > 0
          ? 'partial'
          : 'unknown',
    coverage: result.map(({ part, answers: partAnswers }) => ({
      capability: part.capability,
      label: part.label,
      status: partAnswers.length > 0 ? 'covered' : 'missing',
      answer_refs: partAnswers.map((answer) => answer.revision_ref)
    }))
  }
}

export function diagnosticTopicIdentity(
  artifact: DemandDiagnosisArtifact,
  fallbackParts: NetworkQuestionPart[],
): { topicKey: string; topicSlug: string; scope: Record<string, unknown> } {
  const missing = artifact.missing_capabilities.length > 0
    ? artifact.missing_capabilities
    : fallbackParts.map((part) => part.capability)
  const operatingSystem = normalizeTopicSlug(
    artifact.canonical_context.operating_system,
  )
  const portableFamily = new Set([
    'onie', 'sonic', 'openwrt', 'debian', 'linux', 'cumulus-linux'
  ]).has(operatingSystem)
  const scope = {
    // Portable software demand is intentionally shared across hardware
    // vendors. A later platform-specific record can still override the
    // family-level answer through the normal applicability engine.
    vendor: portableFamily
      ? 'portable'
      : normalizeTopicSlug(artifact.canonical_context.vendor),
    model: portableFamily
      ? 'portable'
      : normalizeTopicSlug(artifact.canonical_context.model),
    operating_system: operatingSystem,
    runtime_mode: artifact.canonical_context.runtime_mode ?? 'normal',
    capabilities: [...new Set(missing)].sort()
  }
  const topicSlug = [
    scope.operating_system,
    scope.runtime_mode,
    ...scope.capabilities.slice(0, 2)
  ].join('-').slice(0, 160)
  return {
    topicKey: sha256Label(JSON.stringify(scope)),
    topicSlug,
    scope
  }
}

export async function replayDemandCoverage(
  client: Database | DatabaseClient,
  demand: { question: string; tool_name: string },
  artifact: DemandDiagnosisArtifact,
): Promise<KnowledgeCoverage & { context: InternalResolvedContext }> {
  const context = await resolveNetworkContext(client as unknown as Database, {
    ...(artifact.canonical_context.vendor
      ? { vendor: artifact.canonical_context.vendor }
      : {}),
    ...(artifact.canonical_context.model
      ? { model: artifact.canonical_context.model }
      : {}),
    operating_system: artifact.canonical_context.operating_system,
    ...(artifact.canonical_context.version
      ? { version: artifact.canonical_context.version }
      : {}),
    ...(artifact.canonical_context.runtime_mode
      ? { runtime_mode: artifact.canonical_context.runtime_mode }
      : {}),
    ...(artifact.canonical_context.shell_environment
      ? { shell_environment: artifact.canonical_context.shell_environment }
      : {})
  })
  const workflow = demand.tool_name === 'get_network_workflow'
  return {
    context,
    ...await searchKnowledgeWithCoverage({
      database: client as unknown as Database,
      question: demand.question,
      context,
      limit: workflow ? 3 : 5,
      ...(workflow
        ? {
            kind: ['workflow', 'change', 'diagnostic'] as PublicKnowledge['kind'][],
            requireAction: true
          }
        : {})
    })
  }
}
