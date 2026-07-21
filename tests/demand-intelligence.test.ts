import { describe, expect, it } from 'vitest'

import {
  decomposeNetworkQuestion,
  normalizeOperatingSystemIntent
} from '../src/domain/network-intent.js'
import {
  answerSupportsCapability,
  demandDiagnosisSubmissionPayload,
  demandDiagnosisAgentArtifactSchema,
  diagnosticTopicIdentity,
  parseDemandDiagnosisAgentArtifact
} from '../src/domain/demand-intelligence.js'
import { sanitizeMcpLogPayload } from '../src/domain/mcp-observability.js'

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
