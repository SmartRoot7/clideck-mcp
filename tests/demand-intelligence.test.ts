import { describe, expect, it } from 'vitest'

import {
  decomposeNetworkQuestion,
  normalizeOperatingSystemIntent
} from '../src/domain/network-intent.js'
import {
  answerProvidesContextualCoverage,
  answerSupportsCapability,
  answerSupportsRequestedAction,
  demandDiagnosisSubmissionPayload,
  demandDiagnosisAgentArtifactSchema,
  diagnosticTopicIdentity,
  parseDemandDiagnosisAgentArtifact
} from '../src/domain/demand-intelligence.js'
import { sanitizeMcpLogPayload } from '../src/domain/mcp-observability.js'
import {
  hasMinimumSemanticRelevance,
  questionRelevanceScore
} from '../src/domain/knowledge.js'

describe('Demand Intelligence', () => {
  it('omits absent context fields instead of persisting the word undefined', () => {
    expect(sanitizeMcpLogPayload({
      vendor: undefined,
      operating_system: 'ONIE',
      nested: { model: undefined, runtime_mode: 'rescue' }
    })).toEqual({
      operating_system: 'ONIE',
      nested: { runtime_mode: 'rescue' }
    })
  })

  it('preserves required nullable diagnosis context fields', () => {
    const parsed = parseDemandDiagnosisAgentArtifact({
      failure_class: 'missing_knowledge',
      answer_status: 'unknown',
      canonical_context: {
        vendor: null,
        model: null,
        operating_system: 'ONIE',
        version: null,
        runtime_mode: 'rescue',
        shell_environment: null
      },
      subquestions: [{
        capability: 'system-reboot',
        label: 'System reboot',
        status: 'missing',
        explanation: 'No applicable reboot command was found in active knowledge.',
        search_terms: ['ONIE rescue reboot']
      }],
      existing_coverage_summary: 'No applicable reboot command is indexed.',
      missing_capabilities: ['system-reboot'],
      search_expansions: ['ONIE rescue reboot'],
      document_roles: ['commands'],
      recommended_action: 'targeted_discovery',
      reasoning_summary: 'Official ONIE command documentation is required.'
    })
    expect(parsed.canonical_context).toMatchObject({
      vendor: null,
      model: null,
      version: null,
      shell_environment: null
    })
  })

  it('repairs deterministic diagnosis wire-format variations', () => {
    const artifact = {
      failure_class: 'missing_knowledge',
      answer_status: 'unknown',
      canonical_context: {
        vendor: 'Dell',
        operating_system: 'ONIE',
        runtime_mode: 'Rescue mode'
      },
      subquestions: [{
        capability: 'system_reboot',
        label: 'System reboot',
        status: 'missing',
        explanation: 'No applicable reboot command was found in active knowledge.',
        search_terms: ['ONIE rescue reboot']
      }],
      existing_coverage_summary: 'No applicable reboot command is indexed.',
      missing_capabilities: ['system reboot'],
      search_expansions: ['ONIE rescue reboot'],
      document_roles: ['command_reference'],
      recommended_action: 'targeted_discovery',
      reasoning_summary: 'Official ONIE command documentation is required.'
    }
    const parsed = parseDemandDiagnosisAgentArtifact(artifact)

    expect(parsed.canonical_context).toEqual({
      vendor: 'Dell',
      model: null,
      operating_system: 'ONIE',
      version: null,
      runtime_mode: 'rescue',
      shell_environment: null
    })
    expect(parsed.subquestions[0]?.capability).toBe('system-reboot')
    expect(parsed.missing_capabilities).toEqual(['system-reboot'])
    expect(parsed.document_roles).toEqual(['commands'])
    expect(demandDiagnosisSubmissionPayload(artifact)).toEqual({
      diagnosis: parsed
    })
  })

  it('bounds diagnosis text and arrays to the strict persisted schema', () => {
    const parsed = parseDemandDiagnosisAgentArtifact({
      failure_class: 'missing_knowledge',
      answer_status: 'unknown',
      canonical_context: {
        vendor: 'V'.repeat(400),
        operating_system: 'ONIE',
        runtime_mode: null
      },
      subquestions: Array.from({ length: 20 }, (_, index) => ({
        capability: `capability_${index}`,
        label: `Capability ${index}`,
        status: 'missing',
        explanation: `Missing evidence for capability ${index}.`,
        search_terms: Array.from({ length: 20 }, (__, term) => `term ${term}`)
      })),
      existing_coverage_summary: 'E'.repeat(2_000),
      missing_capabilities: Array.from({ length: 20 }, (_, index) => `capability_${index}`),
      search_expansions: Array.from({ length: 30 }, (_, index) => `search ${index}`),
      document_roles: Array.from({ length: 10 }, () => 'commands'),
      recommended_action: 'targeted_discovery',
      reasoning_summary: 'R'.repeat(2_000)
    })
    expect(parsed.canonical_context.vendor).toHaveLength(240)
    expect(parsed.subquestions).toHaveLength(12)
    expect(parsed.subquestions[0]?.search_terms).toHaveLength(12)
    expect(parsed.missing_capabilities).toHaveLength(12)
    expect(parsed.search_expansions).toHaveLength(20)
    expect(parsed.document_roles).toEqual(['commands'])
    expect(parsed.reasoning_summary).toHaveLength(1_500)
  })

  it('resolves ONIE Rescue as a software family plus runtime mode', () => {
    expect(normalizeOperatingSystemIntent({
      operatingSystem: 'ONIE Rescue'
    })).toEqual({
      familyRequest: 'ONIE',
      runtimeMode: 'rescue',
      shellEnvironment: null
    })
  })

  it('normalizes an explicit runtime mode phrase', () => {
    expect(normalizeOperatingSystemIntent({
      operatingSystem: 'ONIE',
      runtimeMode: 'Rescue mode'
    })).toEqual({
      familyRequest: 'ONIE',
      runtimeMode: 'rescue',
      shellEnvironment: null
    })
  })

  it('decomposes a compound rescue workflow into verifiable parts', () => {
    const parts = decomposeNetworkQuestion(
      'In ONIE Rescue, reboot safely, set a static IP, inspect ARP and RX errors, then download an image with BusyBox TFTP.',
    )
    expect(parts.map((part) => part.capability)).toEqual([
      'system-reboot',
      'ip-configuration',
      'arp-diagnostics',
      'interface-counters',
      'tftp-transfer'
    ])
  })

  it('keeps startup configuration questions out of boot-mode routing', () => {
    expect(decomposeNetworkQuestion(
      'How do I erase the saved startup configuration?',
    )).toEqual([{
      capability: 'general',
      label: 'Requested operation',
      query: 'How do I erase the saved startup configuration?'
    }])
  })

  it('prefers the requested operation over a generic contextual command', () => {
    const question = 'How do I configure inbound SSH access?'
    const ssh = questionRelevanceScore(question, {
      title: 'Enter SSH management configuration mode',
      summary: 'Configure the SSH server.',
      command_text: 'management ssh',
      procedure_steps: []
    })
    const switchport = questionRelevanceScore(question, {
      title: 'Configure interface switching mode',
      summary: 'Set a switchport access mode.',
      command_text: 'switchport mode access',
      procedure_steps: []
    })
    expect(ssh).toBeGreaterThan(switchport)
  })

  it('rejects a shared incidental word but keeps substantive query matches', () => {
    const counters = {
      title: 'Display interface packet counters',
      summary: 'Inspect packet and error counters on an interface.',
      command_text: 'show interfaces counters errors',
      procedure_steps: []
    }
    expect(hasMinimumSemanticRelevance(
      ['quantum', 'packet', 'teleportation'],
      counters,
    )).toBe(false)
    expect(hasMinimumSemanticRelevance(
      ['interface', 'error', 'counters'],
      counters,
    )).toBe(true)
    expect(hasMinimumSemanticRelevance(['counters'], counters)).toBe(true)
  })

  it('does not confuse an IP-valued syslog setting with IP configuration', () => {
    expect(answerSupportsCapability('ip-configuration', {
      title: 'Configure remote syslog server',
      summary: 'Set the remote log collector IP address.',
      command: 'option log-servers 203.0.113.2;',
      procedure: ['Replace the example IP with the syslog server address.']
    })).toBe(false)
    expect(answerSupportsCapability('ip-configuration', {
      title: 'Configure a temporary interface address',
      summary: 'Add an address to eth0.',
      command: 'ip addr add 192.0.2.10/24 dev eth0',
      procedure: ['Verify the address before continuing.']
    })).toBe(true)
  })

  it('requires a real TFTP client command for TFTP coverage', () => {
    expect(answerSupportsCapability('tftp-transfer', {
      title: 'ONIE self update',
      summary: 'The updater accepts a TFTP URL.',
      command: 'onie-self-update <url>',
      procedure: ['Supported URL schemes include TFTP.']
    })).toBe(false)
    expect(answerSupportsCapability('tftp-transfer', {
      title: 'Download with BusyBox TFTP',
      summary: 'Fetch an installer image.',
      command: 'tftp -g -r installer.bin 192.0.2.20',
      procedure: ['Verify the downloaded image before use.']
    })).toBe(true)
  })

  it('keeps read and destructive configuration intent aligned with evidence', () => {
    expect(answerSupportsRequestedAction(
      'Display the active configuration',
      {
        title: 'Discard uncommitted configuration',
        summary: 'Roll back candidate changes.',
        command: 'rollback',
        procedure: []
      },
    )).toBe(false)
    expect(answerSupportsRequestedAction(
      'Display the active configuration',
      {
        title: 'Display the active configuration',
        summary: 'Show the committed configuration.',
        command: 'show configuration',
        procedure: []
      },
    )).toBe(true)
    expect(answerSupportsRequestedAction(
      'Erase the startup configuration and reload',
      {
        title: 'Reboot the system',
        summary: 'Restarts the device.',
        command: 'reload',
        procedure: []
      },
    )).toBe(false)
  })

  it('does not call widened or versionless upgrade guidance complete', () => {
    const context = {
      vendor: 'Cisco',
      vendor_resolved: true,
      version: '16.10.1'
    } as Parameters<typeof answerProvidesContextualCoverage>[1]
    const base = {
      kind: 'upgrade',
      applicability: {
        vendor: 'Cisco',
        version_match: 'unbounded'
      }
    } as Parameters<typeof answerProvidesContextualCoverage>[2]
    expect(answerProvidesContextualCoverage(
      'Is this upgrade supported and available?',
      context,
      base,
    )).toBe(false)
    expect(answerProvidesContextualCoverage(
      'Is this upgrade supported and available?',
      context,
      {
        ...base,
        applicability: {
          ...base.applicability,
          version_match: 'explicit_range'
        }
      },
    )).toBe(true)
    expect(answerProvidesContextualCoverage(
      'Configure SSH access',
      context,
      {
        ...base,
        applicability: {
          ...base.applicability,
          vendor: 'Pica8',
          version_match: 'same_branch_fallback'
        }
      },
    )).toBe(false)
    expect(answerProvidesContextualCoverage(
      'Configure switch access',
      { ...context, vendor: 'HPE Aruba' },
      {
        ...base,
        applicability: {
          ...base.applicability,
          vendor: 'Hewlett Packard Enterprise',
          operating_system: 'Comware',
          assurance_level: 'best_effort',
          context_relation: 'cross_platform'
        }
      },
    )).toBe(false)
  })

  it('creates the same server-owned topic for equivalent diagnoses', () => {
    const diagnosis = demandDiagnosisAgentArtifactSchema.parse({
      failure_class: 'incomplete_workflow',
      answer_status: 'partial',
      canonical_context: {
        vendor: 'Dell',
        model: 'S5248F-ON',
        operating_system: 'ONIE',
        version: null,
        runtime_mode: 'rescue',
        shell_environment: 'BusyBox'
      },
      subquestions: [{
        capability: 'tftp-transfer',
        label: 'TFTP transfer',
        status: 'missing',
        explanation: 'No complete transfer procedure is currently indexed.',
        search_terms: ['ONIE rescue BusyBox TFTP']
      }],
      existing_coverage_summary: 'Only generic boot concepts were found.',
      missing_capabilities: ['tftp-transfer'],
      search_expansions: ['ONIE rescue BusyBox TFTP'],
      document_roles: ['configuration'],
      recommended_action: 'targeted_discovery',
      reasoning_summary:
        'The request needs a complete rescue-mode transfer procedure.'
    })
    const first = diagnosticTopicIdentity(diagnosis, [])
    const second = diagnosticTopicIdentity(diagnosis, [])
    expect(first.topicKey).toBe(second.topicKey)
    expect(first.topicSlug).toBe('onie-rescue-tftp-transfer')
  })

  it('groups portable ONIE demand across hardware vendors', () => {
    const common = {
      failure_class: 'missing_knowledge' as const,
      answer_status: 'unknown' as const,
      subquestions: [{
        capability: 'tftp-transfer',
        label: 'TFTP transfer',
        status: 'missing' as const,
        explanation: 'No complete transfer procedure is currently indexed.',
        search_terms: ['ONIE rescue BusyBox TFTP']
      }],
      existing_coverage_summary: 'No complete transfer procedure was found.',
      missing_capabilities: ['tftp-transfer'],
      search_expansions: ['ONIE rescue BusyBox TFTP'],
      document_roles: ['configuration' as const],
      recommended_action: 'targeted_discovery' as const,
      reasoning_summary: 'Official ONIE rescue documentation is required.'
    }
    const dell = demandDiagnosisAgentArtifactSchema.parse({
      ...common,
      canonical_context: {
        vendor: 'Dell', model: 'S5248F-ON', operating_system: 'ONIE',
        version: null, runtime_mode: 'rescue', shell_environment: 'BusyBox'
      }
    })
    const nvidia = demandDiagnosisAgentArtifactSchema.parse({
      ...common,
      canonical_context: {
        vendor: 'NVIDIA', model: 'Unknown', operating_system: 'ONIE',
        version: null, runtime_mode: 'rescue', shell_environment: 'BusyBox'
      }
    })
    expect(diagnosticTopicIdentity(dell, []).topicKey)
      .toBe(diagnosticTopicIdentity(nvidia, []).topicKey)
  })
})
