import {
  reviewNetworkChange,
  verifyNetworkChange
} from '../src/domain/change.js'
import {
  finalizeLabReport,
  verifyLabReport
} from '../src/domain/lab.js'
import {
  boundFragmentAnalysisBatch,
  candidateAnalysisArtifactSchema,
  candidateVerificationAgentArtifactSchema,
  candidateVerificationArtifactSchema,
  discoveryArtifactSchema,
  discoverySubmissionSchema,
  expertResearchStructuredArtifactSchema,
  materializeCandidateVerificationArtifact,
  normalizeCandidateAnalysisStableKeys
} from '../src/domain/pipeline.js'
import { chunkSourceText } from '../src/domain/pipeline-worker.js'
import { enforceKnowledgeRisk } from '../src/domain/risk.js'
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
  it('bounds every AI analysis batch by evidence bytes', () => {
    const fragments = [
      { id: 'one', content: 'a'.repeat(30_000) },
      { id: 'two', content: 'b'.repeat(30_000) },
      { id: 'three', content: 'c'.repeat(30_000) }
    ]
    const selected = boundFragmentAnalysisBatch(fragments)
    expect(selected.map((fragment) => fragment.id)).toEqual(['one'])
    expect(
      selected.reduce(
        (bytes, fragment) =>
          bytes + Buffer.byteLength(fragment.content, 'utf8'),
        0,
      ),
    ).toBe(30_000)
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
      fragments.slice(0, 8).map((fragment) => fragment.id),
    )
    expect(
      selected.reduce(
        (bytes, fragment) =>
          bytes + Buffer.byteLength(fragment.content, 'utf8'),
        0,
      ),
    ).toBeLessThan(30_000)
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
          decision: 'manual_review',
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
      'hostname edge-1\nusername val password p4ss\n192.168.20.1 aabb.ccdd.eeff',
      'strict',
    )
    expect(result.sanitized).toContain('[REDACTED_SECRET]')
    expect(result.sanitized).toContain('[REDACTED_IP]')
    expect(result.sanitized).toContain('[REDACTED_MAC]')
    expect(result.sanitized).not.toContain('edge-1')
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

  it('blocks destructive commands and refuses unknown commands', () => {
    const destructive = reviewNetworkChange(config, {
      intent: 'Reload the device',
      context,
      commands: ['reload']
    })
    const unknown = reviewNetworkChange(config, {
      intent: 'Apply an undocumented command',
      context,
      commands: ['mystery feature enable']
    })
    expect(destructive).toMatchObject({
      decision: 'blocked',
      risk_level: 'critical',
      approval_required: true,
      verification_token: null
    })
    expect(unknown.decision).toBe('unknown')
    expect(unknown.verification_token).toBeNull()
  })

  it('issues a signed plan and fails closed during verification', () => {
    const review = reviewNetworkChange(config, {
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

    const passed = verifyNetworkChange(config, {
      verification_token: review.verification_token!,
      before_snapshot: 'Description: old-uplink',
      after_snapshot: 'Description: approved-uplink'
    })
    const failed = verifyNetworkChange(config, {
      verification_token: review.verification_token!,
      before_snapshot: 'Description: old-uplink',
      after_snapshot: '%SYS-2-CRASHED: process failed'
    })
    expect(passed.result).toBe('passed')
    expect(failed.result).toBe('failed')
    expect(failed.rollback_recommended).toBe(true)

    const tampered = `${review.verification_token!.slice(0, -1)}x`
    expect(() =>
      verifyNetworkChange(config, {
        verification_token: tampered,
        before_snapshot: 'before',
        after_snapshot: 'after'
      }),
    ).toThrow('VERIFICATION_TOKEN_INVALID')
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
    expect(known.status).toBe('supported_with_checks')
    expect(known.reload_expected).toBe(true)
    expect(known.security_advisories.map((item) => item.id)).toContain(
      'CVE-2023-20198',
    )
    expect(unknown).toMatchObject({
      status: 'unknown',
      next_action: 'request_expert_answer'
    })
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
    expect(graph.retention).toBe('not_stored')
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
