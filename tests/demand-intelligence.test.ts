import { describe, expect, it } from 'vitest'

import {
  decomposeNetworkQuestion,
  normalizeOperatingSystemIntent
} from '../src/domain/network-intent.js'
import {
  demandDiagnosisAgentArtifactSchema,
  diagnosticTopicIdentity
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

  it('resolves ONIE Rescue as a software family plus runtime mode', () => {
    expect(normalizeOperatingSystemIntent({
      operatingSystem: 'ONIE Rescue'
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
