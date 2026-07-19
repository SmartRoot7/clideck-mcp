import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import {
  CorePolicyError,
  DomainPackRegistry,
  assertManifestCompatibility,
  domainPackManifestV1Schema,
  enforceCoreCandidatePolicy,
  exportDomainPackJsonSchemas,
  runDomainPackConformance,
  type CoreKnowledgeCandidate,
  type CoreKnowledgeRevision,
  type DomainPack
} from './index.js'

const contextSchema = z.strictObject({
  topic: z.string().min(1)
})
const candidateSchema = z.strictObject({
  topic: z.string(),
  title: z.string()
})
const publicRecordSchema = z.strictObject({
  title: z.string()
})

const manifest = {
  schema_version: '1' as const,
  id: 'test-domain',
  version: '1.0.0',
  display_name: 'Test Domain',
  description: 'A deterministic test domain used by conformance fixtures.',
  core_compatibility: {
    minimum: '1.0.0',
    maximum: '1.0.0'
  },
  context_dimensions: [{
    key: 'topic',
    display_name: 'Topic',
    description: 'The exact test topic.',
    value_type: 'string' as const,
    required: true
  }],
  record_types: [{
    id: 'fact',
    display_name: 'Fact',
    description: 'A small verified fact.'
  }],
  capabilities: {
    search: true,
    workflows: false,
    continuous_learning: false,
    artifacts: false,
    spatial: false,
    relations: false,
    lab_validation: false
  }
}

function coreCandidate(): CoreKnowledgeCandidate {
  return {
    domain_id: 'test-domain',
    schema_version: '1',
    stable_key: 'test-domain.fact.one',
    record_type: 'fact',
    title: 'Verified test fact',
    summary: 'A deterministic test record.',
    question_patterns: ['What is the verified test fact?'],
    context: { topic: 'testing' },
    payload: { answer: 'one' },
    prerequisites: [],
    risks: [],
    verification: ['Compare the exact value.'],
    rollback: [],
    limitations: [],
    dangerous: false,
    risk_level: 'safe_read_only',
    confidence: 0.95,
    quality_score: 0.95,
    confidence_reason: 'The fixture is authored and exact.',
    last_verified_at: '2026-07-18',
    provenance: [{
      url: 'https://mcp.clideck.com/demo-data/test.json',
      document_type: 'project_fixture',
      title: 'Project-authored test fixture',
      verified_at: '2026-07-18',
      content_hash: `sha256:${'a'.repeat(64)}`,
      evidence_fragment: 'The exact fixture value is one.',
      evidence_role: 'primary'
    }]
  }
}

const pack: DomainPack<
  z.infer<typeof contextSchema>,
  z.infer<typeof candidateSchema>,
  z.infer<typeof publicRecordSchema>
> = {
  manifest,
  contextSchema,
  candidateSchema,
  publicRecordSchema,
  normalizeContext(input) {
    return contextSchema.parse(input)
  },
  validateCandidate() {
    return { valid: true, issues: [] }
  },
  toCoreCandidate() {
    return coreCandidate()
  },
  fromCoreRevision(revision: CoreKnowledgeRevision) {
    return publicRecordSchema.parse({ title: revision.title })
  }
}

describe('Domain Kit', () => {
  it('rejects unknown manifest fields and duplicate dimensions', () => {
    expect(() => domainPackManifestV1Schema.parse({
      ...manifest,
      unexpected: true
    })).toThrow()
    expect(() => domainPackManifestV1Schema.parse({
      ...manifest,
      context_dimensions: [
        manifest.context_dimensions[0],
        manifest.context_dimensions[0]
      ]
    })).toThrow(/unique/i)
  })

  it('fails fast for incompatible core versions', () => {
    expect(() => assertManifestCompatibility({
      ...manifest,
      core_compatibility: { minimum: '2.0.0' }
    })).toThrow('DOMAIN_PACK_REQUIRES_CORE_2.0.0')
  })

  it('rejects duplicate registrations and missing packs', () => {
    const registry = new DomainPackRegistry()
    registry.register(pack)
    expect(registry.get('test-domain')).toBe(pack)
    expect(() => registry.register(pack)).toThrow(
      'DOMAIN_PACK_DUPLICATE_ID:test-domain',
    )
    expect(() => registry.get('missing')).toThrow(
      'DOMAIN_PACK_NOT_FOUND:missing',
    )
  })

  it('enforces dangerous publication policy', () => {
    expect(() => enforceCoreCandidatePolicy({
      ...coreCandidate(),
      dangerous: true,
      confidence: 0.94,
      risk_level: 'safe_read_only'
    })).toThrow(CorePolicyError)
    expect(() => enforceCoreCandidatePolicy({
      ...coreCandidate(),
      dangerous: true,
      confidence: 0.99,
      risk_level: 'service_disruptive',
      rollback: []
    })).toThrow('Dangerous candidates require')
  })

  it('exports strict JSON Schema 2020-12 documents', () => {
    const schemas = exportDomainPackJsonSchemas(pack)
    expect(schemas.context['$schema']).toBe(
      'https://json-schema.org/draft/2020-12/schema',
    )
    expect(schemas.context['additionalProperties']).toBe(false)
    expect(schemas.candidate['$id']).toContain('/test-domain/1.0.0/')
  })

  it('runs the reusable conformance suite', () => {
    expect(runDomainPackConformance(pack, {
      context: { topic: 'testing' },
      candidate: { topic: 'testing', title: 'Verified test fact' }
    })).toMatchObject({
      domain_id: 'test-domain',
      passed: true
    })
  })
})
