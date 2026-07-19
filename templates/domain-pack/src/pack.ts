import type {
  CoreKnowledgeRevision,
  DomainPack
} from '@clideck/domain-kit'

import {
  candidateSchema,
  contextSchema,
  publicRecordSchema,
  type PackCandidate,
  type PackContext,
  type PackPublicRecord
} from './schemas.js'

export const domainPack: DomainPack<
  PackContext,
  PackCandidate,
  PackPublicRecord
> = {
  manifest: {
    schema_version: '1',
    id: '__DOMAIN_ID__',
    version: '0.1.0',
    display_name: '__DISPLAY_NAME__',
    description: 'A strict, project-owned __DISPLAY_NAME__ knowledge pack.',
    core_compatibility: { minimum: '1.0.0', maximum: '1.0.0' },
    context_dimensions: [{
      key: 'topic',
      display_name: 'Topic',
      description: 'The exact subject area for this record.',
      value_type: 'string',
      required: true
    }],
    record_types: [{
      id: 'fact',
      display_name: 'Fact',
      description: 'A verified domain fact.'
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
  },
  contextSchema,
  candidateSchema,
  publicRecordSchema,
  normalizeContext(input) {
    return contextSchema.parse(input)
  },
  validateCandidate() {
    return { valid: true, issues: [] }
  },
  toCoreCandidate(candidate) {
    return {
      domain_id: '__DOMAIN_ID__',
      schema_version: '1',
      stable_key: candidate.stable_key,
      record_type: 'fact',
      title: candidate.title,
      summary: candidate.summary,
      question_patterns: [candidate.title],
      context: { topic: candidate.topic },
      payload: { answer: candidate.answer },
      prerequisites: [],
      risks: [],
      verification: candidate.verification,
      rollback: [],
      limitations: [],
      dangerous: false,
      risk_level: 'safe_read_only',
      confidence: candidate.confidence,
      quality_score: candidate.quality_score,
      confidence_reason: 'Project-authored fixture verified by the pack owner.',
      last_verified_at: candidate.last_verified_at,
      provenance: [{
        url: 'https://mcp.clideck.com/demo-data/__DOMAIN_ID__.json',
        document_type: 'project_fixture',
        title: '__DISPLAY_NAME__ project fixture',
        verified_at: candidate.last_verified_at,
        content_hash: `sha256:${'c'.repeat(64)}`,
        evidence_fragment: candidate.answer.slice(0, 600),
        evidence_role: 'primary'
      }]
    }
  },
  fromCoreRevision(revision: CoreKnowledgeRevision) {
    return publicRecordSchema.parse({
      title: revision.title,
      summary: revision.summary,
      answer: revision.payload['answer'],
      topic: revision.context['topic'],
      confidence: revision.confidence
    })
  }
}

export const conformanceFixture = {
  context: { topic: 'example' },
  candidate: {
    stable_key: '__DOMAIN_ID__.fact.example',
    topic: 'example',
    title: 'Project-authored example fact',
    summary: 'A safe fixture to replace with domain knowledge.',
    answer: 'Replace this value with an exact, verified fact.',
    verification: ['Compare the stored value with the project fixture.'],
    confidence: 0.95,
    quality_score: 0.95,
    last_verified_at: '2026-07-18'
  }
}
