import { enforceCoreCandidatePolicy } from './core.js'
import {
  assertManifestCompatibility
} from './registry.js'
import type { DomainPack } from './pack.js'

export type DomainPackConformanceFixture = {
  context: unknown
  candidate: unknown
}

export type DomainPackConformanceReport = {
  domain_id: string
  passed: boolean
  checks: string[]
}

export function runDomainPackConformance(
  pack: DomainPack,
  fixture: DomainPackConformanceFixture,
): DomainPackConformanceReport {
  const manifest = assertManifestCompatibility(pack.manifest)
  const context = pack.normalizeContext(fixture.context)
  pack.contextSchema.parse(context)
  const candidate = pack.candidateSchema.parse(fixture.candidate)
  const result = pack.validateCandidate(candidate)
  if (!result.valid) {
    throw new Error(
      `DOMAIN_PACK_CANDIDATE_REJECTED:${result.issues
        .map((issue) => issue.code)
        .join(',')}`,
    )
  }
  const coreCandidate = enforceCoreCandidatePolicy(
    pack.toCoreCandidate(candidate),
  )
  if (coreCandidate.domain_id !== manifest.id) {
    throw new Error('DOMAIN_PACK_CORE_DOMAIN_MISMATCH')
  }
  if (Object.keys(coreCandidate.context).length === 0) {
    throw new Error('DOMAIN_PACK_CORE_CONTEXT_EMPTY')
  }
  return {
    domain_id: manifest.id,
    passed: true,
    checks: [
      'manifest',
      'compatibility',
      'context',
      'candidate',
      'pack_validation',
      'core_policy',
      'core_mapping'
    ]
  }
}
