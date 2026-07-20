import {
  reviewNetworkChangeLegacy
} from '../src/domain/change.js'
import {
  finalizeLabReport,
  verifyLabReport
} from '../src/domain/lab.js'
import {
  bindCandidateAnalysisProvenanceHashes,
  boundFragmentAnalysisBatch,
  automaticUnresolvedDisposition,
  codexCircuitCooldownSeconds,
  candidateAnalysisArtifactSchema,
  candidateDeepReviewAgentArtifactSchema,
  candidateVerificationAgentArtifactSchema,
  candidateVerificationArtifactSchema,
  discoveryArtifactSchema,
  discoverySubmissionSchema,
  expertResearchStructuredArtifactSchema,
  applyDeepReviewRepair,
  getDeterministicRiskDisposition,
  isRetryableCodexPlatformArtifactFailure,
  shouldReduceDeepReviewBatchOnFailure,
  stripUntrustedDeepReviewProvenance,
  materializeCandidateDeepReviewArtifact,
  materializeCandidateVerificationArtifact,
  normalizeCandidateAnalysisOptionalFields,
  normalizeCandidateAnalysisStableKeys,
  withLeasedKnowledgeDemand
} from '../src/domain/pipeline.js'
import {
  chunkSourceText,
  isCandidatePublicationValidationError
} from '../src/domain/pipeline-worker.js'
import { CorePolicyError } from '@clideck/domain-kit'
import { enforceKnowledgeRisk } from '../src/domain/risk.js'
import { buildSearchQueries } from '../src/domain/search-query.js'
import {
  analyzeDeviceSnapshot,
  sanitizeSnapshot
} from '../src/domain/snapshot.js'
import { analyzeNetworkPath } from '../src/domain/topology.js'
import { adviseNetworkUpgrade } from '../src/domain/upgrade.js'
import {
  omitNullObjectProperties,
  openAiStrictJsonSchema
} from '../src/domain/structured-output.js'
import {
  getWorkflowInputSchema,
  queryKnowledgeInputSchema
} from '../src/domain/schemas.js'
import { createTestConfig } from './helpers.js'

describe('knowledge safety classification', () => {
  it('never permits a disruptive command to remain safe', () => {
    const guarded = enforceKnowledgeRisk({
      stable_key: 'cisco-iosxe-reload-risk-guard',
      kind: 'command',
      vendor_slug: 'cisco',
      platform_slug: 'catalyst-9300',
      operating_system_slug: 'ios-xe',
      version_min: '17.9.0',
      title: 'Reload a switch',
      summary: 'Restarts the network device.',
      question_patterns: ['How do I reload this Cisco switch?'],
      cli_mode: 'privileged_exec',
      command: 'reload',
      procedure: [],
      prerequisites: [],
      risks: [],
      verification: ['show version'],
      rollback: [],
      limitations: [],
      dangerous: false,
      risk_level: 'safe_read_only',
      confidence: 0.99,
      quality_score: 0.99,
      confidence_reason:
        'The structured evidence identifies the command and its effect.',
      last_verified_at: '2026-07-18',
      provenance: [{
        url: 'https://www.cisco.com/example',
        document_type: 'command_reference',
        title: 'Internal test evidence',
        verified_at: '2026-07-18',
        content_hash: `sha256:${'a'.repeat(64)}`,
        evidence_fragment: 'reload',
        evidence_role: 'primary'
      }]
    })

    expect(guarded.dangerous).toBe(true)
    expect(guarded.risk_level).toBe('service_disruptive')
  })

  it('requires an explicit rollback before a dangerous candidate can be verified', () => {
    const guarded = enforceKnowledgeRisk({
      stable_key: 'cisco-iosxe-dangerous-rollback-gate',
      kind: 'command',
      vendor_slug: 'cisco',
      platform_slug: 'catalyst-9300',
      operating_system_slug: 'ios-xe',
      version_min: '17.9.0',
      title: 'Reload a switch without rollback',
      summary: 'Restarts the network device.',
      question_patterns: ['How do I reload this Cisco switch?'],
      cli_mode: 'privileged_exec',
      command: 'reload',
      procedure: [],
      prerequisites: ['Use an approved maintenance window.'],
      risks: ['Service interruption.'],
      verification: ['Confirm the device returns to service.'],
      rollback: [],
      limitations: [],
      dangerous: true,
      risk_level: 'service_disruptive',
      confidence: 0.99,
      quality_score: 0.99,
      confidence_reason:
        'The structured evidence identifies the command and its effect.',
      last_verified_at: '2026-07-20',
      provenance: [{
        url: 'https://www.cisco.com/example-dangerous',
        document_type: 'command_reference',
        title: 'Internal test evidence',
        verified_at: '2026-07-20',
        content_hash: `sha256:${'e'.repeat(64)}`,
        evidence_fragment: 'reload',
        evidence_role: 'primary'
      }]
    })

    expect(getDeterministicRiskDisposition(guarded)).toMatchObject({
      decision: 'deep_review',
      finding: expect.stringContaining('rollback')
    })
    expect(getDeterministicRiskDisposition({
      ...guarded,
      rollback: ['Restore the approved saved configuration if recovery fails.']
    })).toBeNull()
  })

  it('keeps read-only inspection commands safe despite risky words', () => {
    const inspected = enforceKnowledgeRisk({
      stable_key: 'cisco-iosxe-show-reload-risk-guard',
      kind: 'command',
      vendor_slug: 'cisco',
      operating_system_slug: 'ios-xe',
      title: 'Inspect reload information',
      summary: 'Shows reload state without changing the device.',
      question_patterns: ['How do I inspect reload state?'],
      cli_mode: 'privileged_exec',
      command: 'show reload',
      procedure: [],
      prerequisites: [],
      risks: [],
      verification: ['Confirm the command returns operational state.'],
      rollback: [],
      limitations: [],
      dangerous: false,
      risk_level: 'safe_read_only',
      confidence: 0.99,
      quality_score: 0.99,
      confidence_reason:
        'The command is a read-only show operation with no state change.',
      last_verified_at: '2026-07-18',
      provenance: [{
        url: 'https://www.cisco.com/example-show',
        document_type: 'command_reference',
        title: 'Internal test evidence',
        verified_at: '2026-07-18',
        content_hash: `sha256:${'b'.repeat(64)}`,
        evidence_fragment: 'show reload',
        evidence_role: 'primary'
      }]
    })

    expect(inspected.dangerous).toBe(false)
    expect(inspected.risk_level).toBe('safe_read_only')
  })
})

describe('deterministic source processing', () => {
  it('backs off repeated identical Codex platform failures adaptively', () => {
    expect(codexCircuitCooldownSeconds(0)).toBe(0)
    expect(codexCircuitCooldownSeconds(3)).toBe(0)
    expect(codexCircuitCooldownSeconds(4)).toBe(30)
    expect(codexCircuitCooldownSeconds(7)).toBe(30)
    expect(codexCircuitCooldownSeconds(8)).toBe(60)
    expect(codexCircuitCooldownSeconds(12)).toBe(120)
    expect(codexCircuitCooldownSeconds(16)).toBe(240)
    expect(codexCircuitCooldownSeconds(20)).toBe(300)
    expect(codexCircuitCooldownSeconds(100)).toBe(300)
  })

  it('does not shrink deep-review batches for a retryable platform error', () => {
    expect(isRetryableCodexPlatformArtifactFailure(
      'INTERNAL_ERROR: The request could not be completed. Retry later with the same safe inputs.',
    )).toBe(true)
    expect(isRetryableCodexPlatformArtifactFailure(
      'The artifact has an invalid candidate index.',
    )).toBe(false)
    expect(shouldReduceDeepReviewBatchOnFailure(
      'AGENT_ARTIFACT_REJECTED',
      'The generated artifact failed validation or submission: INTERNAL_ERROR: The request could not be completed. Retry later with the same safe inputs.',
    )).toBe(false)
    expect(shouldReduceDeepReviewBatchOnFailure(
      'CODEX_PROCESS_FAILED',
      'The ephemeral Codex process failed before producing an artifact.',
    )).toBe(false)
    expect(shouldReduceDeepReviewBatchOnFailure(
      'AGENT_ARTIFACT_REJECTED',
      'The generated artifact failed validation: every candidate index must be returned exactly once.',
    )).toBe(true)
    expect(shouldReduceDeepReviewBatchOnFailure(
      'AGENT_ARTIFACT_REJECTED',
      'The generated artifact failed validation: decisions.0.repaired_candidate.provenance.0.content_hash: Invalid string: must match pattern.',
    )).toBe(false)
  })

  it('adds an unknown-question context only to the leased AI payload', () => {
    const storedTaskPayload = {
      source_id: 'source-1',
      fragments: [{ id: 'fragment-1' }]
    }
    const leasedPayload = withLeasedKnowledgeDemand(storedTaskPayload, {
      question: 'Diagnose MACsec MKA rekey failure on Catalyst 9300',
      tool_name: 'query_network_knowledge',
      context: { vendor_slug: 'cisco', operating_system_slug: 'ios-xe' },
      excluded_source_urls: ['https://www.cisco.com/exhausted-source']
    })

    expect(storedTaskPayload).not.toHaveProperty('knowledge_demand')
    expect(leasedPayload).toMatchObject({
      source_id: 'source-1',
      knowledge_demand: {
        question: 'Diagnose MACsec MKA rekey failure on Catalyst 9300',
        tool_name: 'query_network_knowledge',
        context: { vendor_slug: 'cisco', operating_system_slug: 'ios-xe' },
        excluded_source_urls: ['https://www.cisco.com/exhausted-source']
      }
    })
  })

  it('accepts finite client limits so handlers can clamp them safely', () => {
    const context = {
      vendor: 'Cisco',
      model: 'C9300',
      operating_system: 'IOS XE'
    }
    expect(queryKnowledgeInputSchema.parse({
      question: 'How do I inspect a trunk?',
      context,
      limit: 10
    }).limit).toBe(10)
    expect(getWorkflowInputSchema.parse({
      goal: 'Safely add a VLAN to a trunk',
      context,
      limit: 10
    }).limit).toBe(10)
  })

  it('rejects an unsupported claim after the final evidence review', () => {
    expect(automaticUnresolvedDisposition({
      reviewPass: 'medium',
      dangerous: true,
      confidence: 0.99,
      todayManualExceptions: 3,
      manualExceptionDailyCap: 3
    })).toBe('rejected')
    expect(automaticUnresolvedDisposition({
      reviewPass: 'low',
      dangerous: true,
      confidence: 0.99,
      todayManualExceptions: 3,
      manualExceptionDailyCap: 3
    })).toBe('deep_review')
  })

  it('isolates candidate policy failures from the source package', () => {
    expect(
      isCandidatePublicationValidationError(
        new CorePolicyError(
          'DANGEROUS_CANDIDATE_REQUIRES_ROLLBACK',
          'Dangerous candidates require an explicit rollback procedure.',
        ),
      ),
    ).toBe(true)
    expect(
      isCandidatePublicationValidationError(new Error('connection lost')),
    ).toBe(false)
  })

  it('uses the safe evidence budget for large related analysis fragments', () => {
    const fragments = [
      { id: 'one', content: 'a'.repeat(30_000) },
      { id: 'two', content: 'b'.repeat(30_000) },
      { id: 'three', content: 'c'.repeat(30_000) }
    ]
    const selected = boundFragmentAnalysisBatch(fragments)
    expect(selected.map((fragment) => fragment.id)).toEqual(['one', 'two'])
    expect(
      selected.reduce(
        (bytes, fragment) =>
          bytes + Buffer.byteLength(fragment.content, 'utf8'),
        0,
      ),
    ).toBe(60_000)
  })

  it('batches small related fragments into one AI run', () => {
    const fragments = Array.from(
      { length: 10 },
      (_, index) => ({
        id: `fragment-${index}`,
        content: `model-specific release row ${index}`
      }),
    )
    const selected = boundFragmentAnalysisBatch(fragments)

    expect(selected.map((fragment) => fragment.id)).toEqual(
      fragments.map((fragment) => fragment.id),
    )
    expect(
      selected.reduce(
        (bytes, fragment) =>
          bytes + Buffer.byteLength(fragment.content, 'utf8'),
        0,
      ),
    ).toBeLessThan(65_536)
  })

  it('keeps substantive sections in separate AI runs', () => {
    const selected = boundFragmentAnalysisBatch([
      { id: 'route-map', content: 'a'.repeat(13_112) },
      { id: 'prefix-list', content: 'b'.repeat(9_280) },
      { id: 'policy-routing', content: 'c'.repeat(2_782) }
    ])

    expect(selected.map((fragment) => fragment.id)).toEqual([
      'route-map',
      'prefix-list',
      'policy-routing'
    ])
  })

  it('emits OpenAI-strict object schemas for every AI artifact', () => {
    const unsupportedKeywords = new Set([
      '$schema',
      'default',
      'format',
      'pattern',
      'minLength',
      'maxLength',
      'minimum',
      'maximum',
      'multipleOf',
      'minItems',
      'maxItems'
    ])
    const inspect = (value: unknown): void => {
      if (Array.isArray(value)) {
        value.forEach(inspect)
        return
      }
      if (!value || typeof value !== 'object') return
      const record = value as Record<string, unknown>
      for (const key of Object.keys(record)) {
        expect(unsupportedKeywords.has(key)).toBe(false)
      }
      if (record['type'] === 'object') {
        const properties = record['properties'] as Record<string, unknown>
        expect(record['additionalProperties']).toBe(false)
        expect(record['required']).toEqual(Object.keys(properties))
      }
      Object.values(record).forEach(inspect)
    }

    for (const schema of [
      discoveryArtifactSchema,
      candidateAnalysisArtifactSchema,
      candidateVerificationAgentArtifactSchema,
      candidateVerificationArtifactSchema,
      candidateDeepReviewAgentArtifactSchema,
      expertResearchStructuredArtifactSchema
    ]) {
      const generated = openAiStrictJsonSchema(schema)
      expect(generated['type']).toBe('object')
      inspect(generated)
    }
  })

  it('maps compact verification indexes to the leased candidate IDs', () => {
    const candidateIds = [
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000002'
    ]
    const result = materializeCandidateVerificationArtifact({
      decisions: [
        {
          candidate_index: 1,
          decision: 'verified',
          confidence: 0.96,
          quality_score: 0.94,
          findings: ['Evidence supports the complete claim.']
        },
        {
          candidate_index: 0,
          decision: 'deep_review',
          confidence: 0.89,
          quality_score: 0.9,
          findings: ['Applicability needs review.']
        }
      ]
    }, candidateIds)

    expect(result.decisions.map((decision) => decision.candidate_id)).toEqual([
      candidateIds[1],
      candidateIds[0]
    ])
    expect(() =>
      materializeCandidateVerificationArtifact({
        decisions: [
          {
            candidate_index: 0,
            decision: 'verified',
            confidence: 0.96,
            quality_score: 0.94,
            findings: []
          },
          {
            candidate_index: 0,
            decision: 'verified',
            confidence: 0.96,
            quality_score: 0.94,
            findings: []
          }
        ]
      }, candidateIds),
    ).toThrow('candidate indexes must be unique and leased')

    expect(materializeCandidateVerificationArtifact({
      decisions: [{
        candidate_index: 1,
        decision: 'verified',
        confidence: 0.96,
        quality_score: 0.94,
        findings: []
      }]
    }, candidateIds).decisions).toHaveLength(1)
  })

  it('preserves trusted provenance when a deep reviewer repairs a candidate', () => {
    const original = {
      stable_key: 'cisco-ios-xe-macsec-rekey-repair',
      kind: 'workflow',
      vendor_slug: 'cisco',
      operating_system_slug: 'ios-xe',
      title: 'Diagnose MACsec rekey state',
      summary: 'Checks the bounded MACsec rekey state.',
      question_patterns: ['How do I diagnose MACsec rekey state?'],
      procedure: ['Inspect the current MACsec state.'],
      prerequisites: [],
      risks: [],
      verification: ['Confirm the rekey state is visible.'],
      rollback: [],
      limitations: [],
      dangerous: false,
      risk_level: 'safe_read_only',
      confidence: 0.9,
      quality_score: 0.9,
      confidence_reason: 'The leased evidence supports the bounded check.',
      last_verified_at: '2026-07-20',
      provenance: [{
        url: 'https://www.cisco.com/example-macsec',
        document_type: 'configuration_guide',
        title: 'Trusted leased source',
        verified_at: '2026-07-20',
        content_hash: `sha256:${'d'.repeat(64)}`,
        evidence_fragment: 'MACsec rekey state.',
        evidence_role: 'primary'
      }]
    }
    const materialized = materializeCandidateDeepReviewArtifact({
      decisions: [{
        candidate_index: 0,
        decision: 'verified',
        confidence: 0.96,
        quality_score: 0.95,
        findings: ['The claim was narrowed to the leased evidence.'],
        repaired_candidate: {
          ...original,
          title: 'Repair MACsec rekey state',
          provenance: [{ content_hash: 'not-a-valid-hash' }]
        }
      }]
    }, ['00000000-0000-4000-8000-000000000001'])

    const repaired = applyDeepReviewRepair(
      original,
      materialized.decisions[0]!.repaired_candidate!,
    )
    expect(repaired.title).toBe('Repair MACsec rekey state')
    expect(repaired.provenance).toEqual(original.provenance)
  })

  it('removes echoed deep-review provenance before it reaches validation', () => {
    const sanitized = stripUntrustedDeepReviewProvenance({
      decisions: [{
        candidate_index: 0,
        repaired_candidate: {
          title: 'Echoed repair',
          provenance: [{ content_hash: 'invalid-untrusted-hash' }]
        }
      }]
    }) as {
      decisions: Array<{ repaired_candidate?: Record<string, unknown> }>
    }

    expect(sanitized.decisions[0]!.repaired_candidate).toEqual({
      title: 'Echoed repair'
    })
  })

  it('canonicalizes mechanical stable-key separators before validation', () => {
    const artifact = {
      candidates: [{
        fragment_id: '00000000-0000-4000-8000-000000000001',
        candidate: {
          stable_key: ' Cisco IOS-XE / Show Clock (Detail) ',
          kind: 'command',
          vendor_slug: 'cisco',
          operating_system_slug: 'ios-xe',
          title: 'Show clock detail',
          summary: 'Displays detailed device clock information.',
          question_patterns: ['How do I inspect the detailed clock?'],
          procedure: [],
          prerequisites: [],
          risks: [],
          verification: ['Confirm the clock output is returned.'],
          rollback: [],
          limitations: [],
          dangerous: false,
          risk_level: 'safe_read_only',
          confidence: 0.95,
          quality_score: 0.95,
          confidence_reason: 'The command is directly supported by evidence.',
          last_verified_at: '2026-07-18',
          provenance: [{
            url: 'https://www.cisco.com/example-clock',
            document_type: 'command_reference',
            title: 'Internal test evidence',
            verified_at: '2026-07-18',
            content_hash: `sha256:${'c'.repeat(64)}`,
            evidence_fragment: 'show clock detail',
            evidence_role: 'primary'
          }]
        }
      }],
      rejected_fragments: []
    }

    const normalized = normalizeCandidateAnalysisStableKeys(artifact)
    expect(
      candidateAnalysisArtifactSchema.parse(normalized)
        .candidates[0]!.candidate.stable_key,
    ).toBe('cisco-ios-xe-show-clock-detail')
    expect(artifact.candidates[0]!.candidate.stable_key)
      .toBe(' Cisco IOS-XE / Show Clock (Detail) ')
  })

  it('leaves irreparable stable keys invalid', () => {
    const normalized = normalizeCandidateAnalysisStableKeys({
      candidates: [{
        fragment_id: '00000000-0000-4000-8000-000000000001',
        candidate: { stable_key: '--' }
      }],
      rejected_fragments: []
    })

    expect(() => candidateAnalysisArtifactSchema.parse(normalized))
      .toThrow('stable_key')
  })

  it('drops overlong optional CLI mode prose before validation', () => {
    const original = {
      candidates: [{
        fragment_id: '00000000-0000-4000-8000-000000000001',
        candidate: {
          cli_mode:
            'Enter this mode after authenticating and then continue through ' +
            'several context-dependent configuration levels described by the ' +
            'surrounding procedure before issuing the command.'
        }
      }],
      rejected_fragments: []
    }

    const normalized = normalizeCandidateAnalysisOptionalFields(original) as {
      candidates: Array<{ candidate: { cli_mode?: string } }>
    }

    expect(normalized.candidates[0]!.candidate.cli_mode).toBeUndefined()
    expect(original.candidates[0]!.candidate.cli_mode.length)
      .toBeGreaterThan(120)
  })

  it('binds provenance hashes to trusted leased fragments', () => {
    const fragmentId = '00000000-0000-4000-8000-000000000001'
    const trustedHash = `sha256:${'d'.repeat(64)}`
    const artifact = bindCandidateAnalysisProvenanceHashes({
      candidates: [{
        fragment_id: fragmentId,
        candidate: {
          provenance: [{
            content_hash: 'sha256:model-transcription-error'
          }]
        }
      }],
      rejected_fragments: []
    }, [{
      id: fragmentId,
      content_hash: trustedHash
    }]) as {
      candidates: Array<{
        candidate: {
          provenance: Array<{ content_hash: string }>
        }
      }>
    }

    expect(
      artifact.candidates[0]!.candidate.provenance[0]!.content_hash,
    ).toBe(trustedHash)
  })

  it('models optional structured-output properties as nullable required fields', () => {
    const schema = openAiStrictJsonSchema(
      candidateAnalysisArtifactSchema,
    )
    const candidates = (
      schema['properties'] as Record<string, Record<string, unknown>>
    )['candidates']!
    const candidate = (
      (
        candidates['items'] as Record<string, unknown>
      )['properties'] as Record<string, Record<string, unknown>>
    )['candidate']!
    const candidateProperties = candidate['properties'] as Record<
      string,
      Record<string, unknown>
    >
    expect(candidateProperties['platform_slug']!['anyOf']).toEqual(
      expect.arrayContaining([{ type: 'null' }]),
    )
    expect(candidateProperties['command']!['anyOf']).toEqual(
      expect.arrayContaining([{ type: 'null' }]),
    )
  })

  it('removes wire nulls before applying the original Zod artifact contract', () => {
    const wireArtifact = {
      sources: [{
        canonical_url: 'https://www.cisco.com/example',
        document_type: 'command_reference',
        title: 'Example command reference',
        document_version: null,
        document_date: null
      }],
      rejection_reason: null
    }
    expect(discoveryArtifactSchema.parse(
      omitNullObjectProperties(wireArtifact),
    )).toEqual({
      sources: [{
        canonical_url: 'https://www.cisco.com/example',
        document_type: 'command_reference',
        title: 'Example command reference'
      }]
    })
  })

  it('uses an object-root expert envelope instead of a root anyOf', () => {
    const schema = openAiStrictJsonSchema(
      expertResearchStructuredArtifactSchema,
    )
    expect(schema['type']).toBe('object')
    expect(schema['anyOf']).toBeUndefined()
    expect(expertResearchStructuredArtifactSchema.parse({
      outcome: 'rejected',
      candidate: null,
      reason: 'Official evidence was not sufficient for a safe answer.'
    }).outcome).toBe('rejected')
  })

  it('requires every discovery run to produce a source or rejection artifact', () => {
    const lease = {
      pipeline_task_id: '00000000-0000-4000-8000-000000000001',
      lease_token: 'x'.repeat(32)
    }
    expect(discoverySubmissionSchema.safeParse({
      ...lease,
      sources: []
    }).success).toBe(false)
    expect(discoverySubmissionSchema.safeParse({
      ...lease,
      sources: [],
      rejection_reason:
        'No official public document matched the bounded coverage target.'
    }).success).toBe(true)
  })

  it('chunks a large document without loss or oversized fragments', () => {
    const sections = Array.from(
      { length: 220 },
      (_, index) =>
        `SECTION ${index + 1}\n\nshow interface ethernet ${index + 1}\n` +
        `Operational detail ${index + 1}. `.repeat(80),
    )
    const source = sections.join('\n\n')
    const fragments = chunkSourceText(source)
    expect(fragments.length).toBeGreaterThan(1)
    expect(fragments.every(
      (fragment) =>
        Buffer.byteLength(fragment.content, 'utf8') <= 30_000,
    )).toBe(true)
    expect(new Set(fragments.map((fragment) => fragment.contentHash)).size)
      .toBe(fragments.length)
    for (let index = 0; index < 220; index += 1) {
      expect(
        fragments.some((fragment) =>
          fragment.content.includes(
            `show interface ethernet ${index + 1}`,
          ),
        ),
      ).toBe(true)
    }
  })

  it('chunks a large multibyte document without oversized fragments', () => {
    const source = `${'🔐 network-state '.repeat(30_000)}\n\nshow version`
    const startedAt = performance.now()
    const fragments = chunkSourceText(source)
    expect(performance.now() - startedAt).toBeLessThan(2_000)
    expect(fragments.length).toBeGreaterThan(1)
    expect(fragments.every(
      (fragment) =>
        Buffer.byteLength(fragment.content, 'utf8') <= 30_000,
    )).toBe(true)
    expect(fragments.some((fragment) =>
      fragment.content.includes('show version'),
    )).toBe(true)
  })

  it('deduplicates repeated source fragments before persistence', () => {
    const repeated = [
      'show clock',
      'Displays the current system clock without changing device state.'
    ].join('\n')
    const source = [
      'SECTION ONE',
      repeated,
      'SECTION TWO',
      repeated,
      'SECTION THREE',
      'show version\nDisplays platform and software version details.'
    ].join('\n\n')

    const fragments = chunkSourceText(source)

    expect(fragments).toHaveLength(2)
    expect(fragments.map((fragment) => fragment.ordinal)).toEqual([0, 1])
    expect(new Set(fragments.map((fragment) => fragment.contentHash)).size)
      .toBe(fragments.length)
    expect(fragments.filter((fragment) => fragment.content === repeated))
      .toHaveLength(1)
  })

  it('removes dense PDF contents pages without dropping body commands', () => {
    const contentsPage = [
      'CONTENTS',
      'Overview........................................................ 1',
      'Initial configuration.......................................... 8',
      'Interface commands............................................ 42',
      'Routing commands.............................................. 87',
      'Security policy.............................................. 131',
      'Diagnostics.................................................. 205',
      'Upgrade procedures........................................... 260',
      'Appendix..................................................... 310'
    ].join('\n')
    const bodyPages = Array.from(
      { length: 12 },
      (_, index) => [
        'INTERFACE DIAGNOSTICS',
        '',
        `Use show interface ethernet ${index} to inspect link state.`,
        '',
        `show interface ethernet ${index}`
      ].join('\n'),
    )
    const source = [
      'NETWORK OS CLI REFERENCE',
      contentsPage,
      ...bodyPages
    ].join('\f')

    const fragments = chunkSourceText(source)

    for (let index = 0; index < bodyPages.length; index += 1) {
      expect(fragments.some((fragment) =>
        fragment.content.includes(`show interface ethernet ${index}`),
      )).toBe(true)
    }
    expect(fragments.length).toBeLessThan(bodyPages.length)
    expect(fragments.every((fragment) =>
      !fragment.content.includes('Initial configuration........'),
    )).toBe(true)
  })
})

describe('device snapshot intelligence', () => {
  it('fingerprints IOS-XE and removes secrets and identifiers', () => {
    const result = analyzeDeviceSnapshot({
      snapshot: [
        'Cisco IOS XE Software, Version 17.15.5',
        'cisco C9300-48UXM (X86) processor',
        'System Serial Number : FOC1234ABCD',
        'hostname dist-sw-01',
        'username admin secret 9 super-secret-hash',
        'interface Vlan10',
        ' ip address 10.20.30.1/24'
      ].join('\n'),
      snapshot_type: 'auto',
      redaction_profile: 'strict'
    })

    expect(result.context).toMatchObject({
      vendor: 'Cisco',
      model: 'C9300-48UXM',
      operating_system: 'Cisco IOS XE',
      version: '17.15.5',
      support_level: 'deep'
    })
    expect(result.snapshot_type).toBe('show_version')
    expect(result.sanitized_snapshot).not.toContain('FOC1234ABCD')
    expect(result.sanitized_snapshot).not.toContain('super-secret-hash')
    expect(result.sanitized_snapshot).not.toContain('10.20.30.1')
    expect(result.sanitized_snapshot).not.toContain('dist-sw-01')
    expect(result.retention).toBe('not_stored')
  })

  it('normalizes the common Catalyst 9300 display name', () => {
    const result = analyzeDeviceSnapshot({
      snapshot: [
        'Cisco Catalyst 9300-48P',
        'Cisco IOS XE Software, Version 17.9.4',
        'username operator secret 9 SENTINEL-SNAPSHOT'
      ].join('\n'),
      snapshot_type: 'show_version',
      redaction_profile: 'secrets_only'
    })

    expect(result.context).toMatchObject({
      vendor: 'Cisco',
      model: 'C9300-48P',
      operating_system: 'Cisco IOS XE',
      version: '17.9.4',
      support_level: 'deep'
    })
    expect(result.sanitized_snapshot).not.toContain('SENTINEL-SNAPSHOT')
  })

  it('recognizes Junos and EOS without claiming deep coverage', () => {
    const junos = analyzeDeviceSnapshot({
      snapshot: 'Model: qfx5120-48y\nJunos: 23.4R2-S3.7',
      snapshot_type: 'show_version',
      redaction_profile: 'secrets_only'
    })
    const eos = analyzeDeviceSnapshot({
      snapshot:
        'Arista Networks EOS\nModel name: DCS-7050SX3-48YC8\nSoftware image version: 4.33.2F',
      snapshot_type: 'show_version',
      redaction_profile: 'secrets_only'
    })
    expect(junos.context).toMatchObject({
      vendor: 'Juniper',
      support_level: 'recognized'
    })
    expect(eos.context).toMatchObject({
      vendor: 'Arista',
      support_level: 'recognized'
    })
  })

  it('strictly re-redacts contributed output', () => {
    const result = sanitizeSnapshot(
      'hostname edge-1\nusername val password p4ss\n192.168.20.1 fd12:3456::1 aabb.ccdd.eeff',
      'strict',
    )
    expect(result.sanitized).toContain('[REDACTED_SECRET]')
    expect(result.sanitized).toContain('[REDACTED_IP]')
    expect(result.sanitized).toContain('[REDACTED_MAC]')
    expect(result.sanitized).not.toContain('edge-1')
    expect(result.sanitized).not.toContain('fd12:3456::1')
  })
})

describe('change guard and post-change verification', () => {
  const config = createTestConfig()
  const context = {
    vendor: 'Cisco',
    model: 'C9300-48UXM',
    operating_system: 'IOS XE',
    version: '17.15.5'
  }

  it('returns guidance and verification for destructive and unknown commands', () => {
    const destructive = reviewNetworkChangeLegacy(config, {
      intent: 'Erase the saved configuration',
      context,
      commands: ['write erase']
    })
    const unknown = reviewNetworkChangeLegacy(config, {
      intent: 'Apply an undocumented command',
      context,
      commands: ['mystery feature enable']
    })
    expect(destructive).toMatchObject({
      decision: 'allowed_with_checks',
      risk_level: 'high',
      approval_required: true,
      matched_rules: ['erase_startup_configuration']
    })
    expect(destructive.verification_token).toBeTruthy()
    expect(destructive.operational_guidance.join(' ')).toContain(
      'saved startup configuration',
    )
    expect(unknown).toMatchObject({
      decision: 'allowed_with_checks',
      risk_level: 'high',
      approval_required: true
    })
    expect(unknown.verification_token).toBeTruthy()
    expect(unknown.operational_guidance.join(' ')).toContain(
      'meaning was not inferred',
    )
    const secret = reviewNetworkChangeLegacy(config, {
      intent: 'Review an unknown credential command',
      context,
      commands: ['mystery password SuperSecret12345']
    })
    expect(secret.unknown_commands[0]).not.toContain('SuperSecret12345')
    for (const separator of [
      '\n',
      '\r\n',
      '\r',
      '\u0085',
      '\u2028',
      '\u2029'
    ]) {
      for (const injectedWrite of [
        'router ospf 1',
        'ip route 10.0.0.0 255.0.0.0 192.0.2.1',
        'ip access-list extended EDGE',
        'spanning-tree vlan 10 root primary',
        'vlan 4000',
        'mystery feature enable'
      ]) {
        const multiline = reviewNetworkChangeLegacy(config, {
          intent: 'Reject a write hidden after a read-only command',
          context,
          commands: [`show version${separator}${injectedWrite}`]
        })
        expect(multiline.decision).toBe('allowed_with_checks')
        expect(multiline.approval_required).toBe(true)
        expect(multiline.risk_level).toBe('high')
        expect(multiline.verification_token).toBeTruthy()
      }
    }
    const configDiff = reviewNetworkChangeLegacy(config, {
      intent: 'Review a write hidden in a bare-CR configuration diff',
      context,
      config_diff: 'show version\rrouter bgp 65000'
    })
    expect(configDiff.decision).toBe('allowed_with_checks')
    expect(configDiff.approval_required).toBe(true)
    expect(configDiff.verification_token).toBeTruthy()
  })

  it('issues a signed plan and fails closed during verification', () => {
    const review = reviewNetworkChangeLegacy(config, {
      intent: 'Update the approved interface description',
      context,
      commands: [
        'configure terminal',
        'interface GigabitEthernet1/0/1',
        'description approved-uplink'
      ]
    })
    expect(review.verification_token).toBeTruthy()
    expect(review.approval_required).toBe(true)

    const tampered = `${review.verification_token!.slice(0, -1)}x`
    expect(tampered).not.toBe(review.verification_token)
  })
})

describe('upgrade and topology intelligence', () => {
  it('returns bounded upgrade advice and refuses unsupported transitions', () => {
    const known = adviseNetworkUpgrade({
      model: 'C9300-48UXM',
      operating_system: 'IOS XE',
      current_version: '17.12.4',
      target_version: '17.15.5',
      enabled_features: ['HTTPS Web UI']
    })
    const unknown = adviseNetworkUpgrade({
      model: 'C9500-48Y4C',
      operating_system: 'IOS XE',
      current_version: '17.12.4',
      target_version: '17.15.5',
      enabled_features: []
    })
    const prefixedModel = adviseNetworkUpgrade({
      model: 'Cisco Catalyst C9300-48P',
      operating_system: 'IOS-XE',
      current_version: '17.9.5',
      target_version: '17.15.5',
      enabled_features: []
    })
    const humanModel = adviseNetworkUpgrade({
      model: 'Cisco Catalyst 9300',
      operating_system: 'IOS-XE',
      current_version: '17.9.5',
      target_version: '17.15.5',
      enabled_features: []
    })
    expect(known.status).toBe('supported_with_checks')
    expect(known.reload_expected).toBe(true)
    expect(known.security_advisories.map((item) => item.id)).toContain(
      'CVE-2023-20198',
    )
    expect(unknown).toMatchObject({
      status: 'unknown',
      next_action: 'request_expert_answer'
    })
    expect(prefixedModel.status).toBe('supported_with_checks')
    expect(humanModel.status).toBe('supported_with_checks')
  })

  it('builds a graph from CDP and identifies an incomplete traceroute', () => {
    const graph = analyzeNetworkPath({
      source: 'access-1',
      destination: '203.0.113.10',
      snapshots: [
        {
          device_hint: 'access-1',
          output_type: 'cdp',
          content: [
            'Device ID: dist-1',
            'IP address: 10.0.0.2',
            'Platform: cisco C9300-48UXM, Capabilities: Switch',
            'Interface: GigabitEthernet1/0/48, Port ID (outgoing port): GigabitEthernet1/0/1'
          ].join('\n')
        },
        {
          device_hint: 'access-1',
          output_type: 'traceroute',
          content: [
            'traceroute to 203.0.113.10',
            ' 1  dist-1 (10.0.0.2) 1 ms',
            ' 2  * * *'
          ].join('\n')
        }
      ]
    })
    expect(graph.nodes.some((node) => node.label === 'dist-1')).toBe(true)
    expect(graph.edges.some((edge) => edge.protocol === 'cdp')).toBe(true)
    expect(graph.paths[0]?.complete).toBe(false)
    expect(graph.probable_fault_domain).toBe('dist-1')
    expect(graph.parse_diagnostics).toHaveLength(2)
    expect(graph.retention).toBe('not_stored')
    const redacted = analyzeNetworkPath({
      snapshots: [{
        device_hint: 'Bearer abcdefghijklmnopqrstuvwxyz',
        output_type: 'traceroute',
        content: [
          'traceroute to 203.0.113.10',
          '1 edge.example (10.0.0.2) 1 ms',
          'password SuperSecret12345'
        ].join('\n')
      }]
    })
    expect(JSON.stringify(redacted)).not.toContain(
      'abcdefghijklmnopqrstuvwxyz',
    )
    expect(JSON.stringify(redacted)).not.toContain('SuperSecret12345')

    const selfReference = analyzeNetworkPath({
      snapshots: [{
        device_hint: 'access-1',
        output_type: 'lldp',
        content: [
          'Local Interface: Gi1/0/1',
          'System Name: access-1',
          'Port ID: Gi1/0/2'
        ].join('\n')
      }]
    })
    expect(selfReference.edges).toHaveLength(0)
    expect(selfReference.parse_diagnostics[0]).toMatchObject({
      status: 'unparsed',
      warnings: ['self_reference_ignored']
    })

    const abbreviated = analyzeNetworkPath({
      snapshots: [
        {
          device_hint: 'DIST1',
          output_type: 'cdp',
          content:
            'Device ID: DIST1; Local Interface: Gig 1/0/1; Port ID (outgoing port): Gig 1/0/48'
        },
        {
          device_hint: 'DIST1',
          output_type: 'lldp',
          content:
            'Local Intf: Gi1/0/2; Chassis id: 00:11:22:33:44:55; Port id: Ethernet1'
        }
      ]
    })
    expect(abbreviated.edges).toHaveLength(1)
    expect(abbreviated.edges[0]).toMatchObject({
      protocol: 'lldp',
      local_interface: 'Gi1/0/2',
      remote_interface: 'Ethernet1'
    })
    expect(abbreviated.parse_diagnostics[0]).toMatchObject({
      status: 'unparsed',
      warnings: ['self_reference_ignored']
    })
  })
})

describe('human knowledge search normalization', () => {
  it('removes conversational device context and normalizes port-error terms', () => {
    const question =
      'On a Catalyst 9300 with IOS-XE 17.9.4, how do I check errors on ports?'
    const expandedQuestion = question.replace(
      /\berrors?\b/i,
      'display interface counters errors',
    )
    const query = buildSearchQueries(
      expandedQuestion,
      {
        '9300': '',
        c9300: '',
        errors: 'error',
        interfaces: 'interface',
        port: 'interface',
        ports: 'interface'
      },
    )

    expect(query.strictTsQuery).toBe(
      'display:* & interface:* & counters:* & error:*',
    )
    expect(query.relaxedTsQuery).toContain(
      '(interface:* & counters:* & error:*)',
    )
    expect(query.strictTsQuery).not.toContain('17')
  })

  it('treats punctuation and tsquery operators only as input text', () => {
    const query = buildSearchQueries(
      'Demo block A | !secret <-> reference length',
    )

    expect(query.strictTsQuery).toBe(
      'demo:* & block:* & secret:* & reference:* & length:*',
    )
  })
})

describe('commit-bound lab assurance', () => {
  const commitSha = 'a'.repeat(40)

  it('rejects report tampering and false Cisco runtime badges', () => {
    const report = finalizeLabReport({
      schema_version: 1,
      commit_sha: commitSha,
      generated_at: '2026-07-17T12:00:00.000Z',
      validations: [{
        stable_key: 'cisco.ios-xe.show-ip-route',
        revision_hash: `sha256:${'0'.repeat(64)}`,
        validation_type: 'batfish_modeled',
        fixture_key: 'c9300-route-model',
        tool_version: 'batfish-2025.07.07.2423',
        status: 'passed',
        summary: 'The bounded Cisco configuration model parsed successfully.',
        executed_at: '2026-07-17T12:00:00.000Z',
        expires_at: '2026-10-15T12:00:00.000Z',
        details: { modeled_only: true }
      }],
      checks: [{
        check_type: 'batfish_parse',
        status: 'passed',
        summary: 'The fixture parsed.',
        details: {}
      }]
    })
    expect(verifyLabReport(report).report_hash).toBe(report.report_hash)
    const { report_hash: _reportHash, ...unsignedReport } = report
    const expired = finalizeLabReport({
      ...unsignedReport,
      validations: report.validations.map((validation) => ({
        ...validation,
        expires_at: '2026-07-18T12:00:00.000Z'
      }))
    })
    expect(() => verifyLabReport(expired)).toThrow(
      'LAB_VALIDATION_EXPIRED',
    )
    expect(() =>
      verifyLabReport({
        ...report,
        commit_sha: 'b'.repeat(40)
      }),
    ).toThrow('LAB_REPORT_HASH_MISMATCH')

    const falseRuntime = finalizeLabReport({
      schema_version: 1,
      commit_sha: commitSha,
      generated_at: '2026-07-17T12:00:00.000Z',
      validations: [{
        stable_key: 'cisco.ios-xe.show-ip-route',
        revision_hash: `sha256:${'0'.repeat(64)}`,
        validation_type: 'runtime_lab_validated',
        fixture_key: 'open-frr-runtime',
        tool_version: 'containerlab-0.72.0',
        status: 'passed',
        summary: 'Only an FRRouting image was actually run.',
        executed_at: '2026-07-17T12:00:00.000Z',
        expires_at: '2026-10-15T12:00:00.000Z',
        runtime_vendor: 'FRRouting',
        runtime_image_tested: true,
        details: {}
      }],
      checks: [{
        check_type: 'containerlab_runtime_parser',
        status: 'passed',
        summary: 'The open-image parser scenario passed.',
        details: {}
      }]
    })
    expect(() => verifyLabReport(falseRuntime)).toThrow(
      'CISCO_RUNTIME_VALIDATION_REQUIRES_CISCO_IMAGE',
    )
  })
})
