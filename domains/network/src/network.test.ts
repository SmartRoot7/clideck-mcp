import {
  enforceCoreCandidatePolicy,
  runDomainPackConformance
} from '@clideck/domain-kit'
import { describe, expect, it } from 'vitest'

import {
  networkConformanceFixture,
  networkCommandReferenceExtractor,
  networkDomainPack,
  networkKnowledgeCandidateSchema
} from './index.js'

const candidate = networkConformanceFixture.candidate

describe('Network Domain Pack', () => {
  it('extracts structured command references without Luna', () => {
    const result = networkCommandReferenceExtractor.extract({
      source: {
        canonical_url: 'https://vendor.example/command-reference',
        document_type: 'command_reference',
        title: 'Command reference',
        document_version: '17.15',
        document_date: '2026-07-19'
      },
      context: {
        vendor_slug: 'cisco',
        operating_system_slug: 'ios-xe',
        platform_slug: 'catalyst-9000',
        version_min: '17.15',
        version_max: '17.15'
      },
      verified_at: '2026-07-19',
      fragments: [{
        id: '00000000-0000-4000-8000-000000000001',
        ordinal: 0,
        section_title: 'Show interfaces status',
        source_locator: 'page:1',
        content: [
          'Show interfaces status',
          'Displays interface status information.',
          'show interfaces status',
          'Syntax Description',
          'show',
          'Displays running system information.',
          'Command Mode',
          'Privileged EXEC'
        ].join('\n'),
        content_hash:
          'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
      }]
    })
    expect(result.handled_fragment_ids).toHaveLength(1)
    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0]?.candidate).toMatchObject({
      command: 'show interfaces status',
      dangerous: false,
      risk_level: 'safe_read_only'
    })
  })

  it('does not truncate dense official command-reference fragments', () => {
    const commands = [
      'show clock',
      'show version',
      'show inventory',
      'show interfaces',
      'show ip route',
      'show ipv6 route',
      'show logging',
      'show processes',
      'show running-config',
      'show startup-config',
      'show users',
      'show platform'
    ]
    const result = networkCommandReferenceExtractor.extract({
      source: {
        canonical_url: 'https://vendor.example/dense-command-reference',
        document_type: 'command_reference',
        title: 'Dense command reference',
        document_version: null,
        document_date: null
      },
      context: {
        vendor_slug: 'cisco',
        operating_system_slug: 'ios-xe'
      },
      verified_at: '2026-08-26',
      fragments: [{
        id: '00000000-0000-4000-8000-000000000001',
        ordinal: 0,
        section_title: 'Operational commands',
        source_locator: 'page:1',
        content: commands
          .map((command) => [
            command,
            `Displays documented information for ${command}.`,
            command,
            'Syntax Description',
            command.split(' ')[0],
            `Selects the documented ${command} operation.`,
            'Command Mode',
            '/exec'
          ].join('\n'))
          .join('\n'),
        content_hash:
          'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
      }]
    })

    expect(result.handled_fragment_ids).toHaveLength(1)
    expect(result.candidates).toHaveLength(commands.length)
    expect(result.candidates.every((entry) =>
      entry.ready_for_publication === true
    )).toBe(true)
    expect(result.candidates.at(-1)?.candidate).toMatchObject({
      command: 'show platform',
      summary: 'Displays documented information for show platform.'
    })
  })

  it('extracts wrapped Cisco syntax and inline Syntax Description fields', () => {
    const result = networkCommandReferenceExtractor.extract({
      source: {
        canonical_url: 'https://vendor.example/cisco-command-reference.pdf',
        document_type: 'command reference',
        title: 'Cisco IOS MPLS Command Reference',
        document_version: null,
        document_date: null
      },
      context: {
        vendor_slug: 'cisco',
        operating_system_slug: 'cisco-ios-ios-xe'
      },
      verified_at: '2026-08-26',
      fragments: [{
        id: '00000000-0000-4000-8000-000000000001',
        ordinal: 0,
        section_title: null,
        source_locator: 'page:1074',
        content: [
          'show mpls traffic-eng topology path',
          'To show the best available path to a destination, use this command.',
          '',
          'show mpls traffic-eng topology path {tunnel-interface [destination address] | destination address}',
          '  [bandwidth value] [priority value [value]] [affinity value [mask mask]]',
          '',
          'Syntax Description         tunnel-interface  Name of an MPLS traffic engineering interface.',
          '',
          'destination address  (Optional) IP address specifying the path destination.',
          '',
          'bandwidth value  (Optional) Required available bandwidth.',
          '',
          'Command Modes',
          'User EXEC',
          'Privileged EXEC',
          '',
          'Command History',
          '12.1(3)T  This command was introduced.',
          '',
          '12.2(33)SRA  This command was integrated into this release.',
          '',
          'Usage Guidelines',
          'The specified constraints override constraints from a reference tunnel.'
        ].join('\n'),
        content_hash:
          'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
      }]
    })

    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0]?.ready_for_publication).toBe(true)
    expect(result.candidates[0]?.candidate).toMatchObject({
      command: 'show mpls traffic-eng topology path {tunnel-interface [destination address] | destination address} [bandwidth value] [priority value [value]] [affinity value [mask mask]]',
      cli_mode: 'privileged_exec',
      procedure: [],
      syntax_options: [
        'tunnel-interface Name of an MPLS traffic engineering interface.',
        'destination address (Optional) IP address specifying the path destination.',
        'bandwidth value (Optional) Required available bandwidth.'
      ]
    })
    expect(result.candidates[0]?.candidate.limitations).toContain(
      'Documented release history: 12.1(3)T This command was introduced.',
    )
  })

  it('omits syntax_options when the reference has no option rows', () => {
    const result = networkCommandReferenceExtractor.extract({
      source: {
        canonical_url: 'https://vendor.example/no-options-reference',
        document_type: 'command_reference',
        title: 'Command reference',
        document_version: null,
        document_date: null
      },
      context: {
        vendor_slug: 'cisco',
        operating_system_slug: 'ios-xe'
      },
      verified_at: '2026-08-26',
      fragments: [{
        id: '00000000-0000-4000-8000-000000000001',
        ordinal: 0,
        section_title: null,
        source_locator: 'page:1',
        content: [
          'show clock',
          '',
          'Syntax Description',
          'Command Mode',
          'Privileged EXEC'
        ].join('\n'),
        content_hash:
          'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
      }]
    })

    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0]?.candidate).not.toHaveProperty(
      'syntax_options',
    )
  })

  it('does not declare prose-like fallback matches ready or fully handled', () => {
    const result = networkCommandReferenceExtractor.extract({
      source: {
        canonical_url: 'https://vendor.example/command-reference',
        document_type: 'command_reference',
        title: 'Command reference',
        document_version: null,
        document_date: null
      },
      context: {
        vendor_slug: 'cisco',
        operating_system_slug: 'ios-xe'
      },
      verified_at: '2026-08-26',
      fragments: [{
        id: '00000000-0000-4000-8000-000000000001',
        ordinal: 0,
        section_title: 'Operational commands',
        source_locator: 'page:1',
        content: 'show how to configure BGP',
        content_hash:
          'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
      }]
    })

    expect(result.handled_fragment_ids).toEqual([])
    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0]?.ready_for_publication).toBe(false)
  })

  it('does not mark a mixed structured and fallback fragment fully handled', () => {
    const result = networkCommandReferenceExtractor.extract({
      source: {
        canonical_url: 'https://vendor.example/mixed-command-reference',
        document_type: 'command_reference',
        title: 'Mixed command reference',
        document_version: 'Cisco IOS XE 17.15 and later',
        document_date: null
      },
      context: {
        vendor_slug: 'cisco',
        operating_system_slug: 'ios-xe',
        version_min: null,
        version_max: null
      },
      verified_at: '2026-08-26',
      fragments: [{
        id: '00000000-0000-4000-8000-000000000001',
        ordinal: 0,
        section_title: 'Mixed commands',
        source_locator: 'page:1',
        content: [
          'show clock',
          'Syntax Description',
          'show',
          'Displays running system information.',
          'Command Mode',
          '/exec',
          'set system host-name router-1'
        ].join('\n'),
        content_hash:
          'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
      }]
    })

    expect(result.handled_fragment_ids).toEqual([])
    expect(result.candidates.map((entry) => ({
      command: entry.candidate.command,
      ready: entry.ready_for_publication
    }))).toEqual([
      { command: 'show clock', ready: true },
      { command: 'set system host-name router-1', ready: false }
    ])
  })

  it('does not borrow a following command description', () => {
    const result = networkCommandReferenceExtractor.extract({
      source: {
        canonical_url: 'https://vendor.example/fallback-command-reference',
        document_type: 'command_reference',
        title: 'Fallback command reference',
        document_version: null,
        document_date: null
      },
      context: {
        vendor_slug: 'cisco',
        operating_system_slug: 'ios-xe'
      },
      verified_at: '2026-08-26',
      fragments: [{
        id: '00000000-0000-4000-8000-000000000001',
        ordinal: 0,
        section_title: null,
        source_locator: 'page:1',
        content: [
          'show clock',
          'show version',
          'Displays software version information.'
        ].join('\n'),
        content_hash:
          'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
      }]
    })

    expect(result.candidates[0]?.candidate.summary).not.toContain('software version')
    expect(result.candidates[1]?.candidate.summary).toBe(
      'Displays software version information.',
    )
    expect(result.handled_fragment_ids).toEqual([])
  })

  it('does not mark a truncated syntax-description block fully handled', () => {
    const result = networkCommandReferenceExtractor.extract({
      source: {
        canonical_url: 'https://vendor.example/truncated-reference',
        document_type: 'command_reference',
        title: 'Truncated command reference',
        document_version: null,
        document_date: null
      },
      context: {
        vendor_slug: 'juniper',
        operating_system_slug: 'junos'
      },
      verified_at: '2026-08-26',
      fragments: [{
        id: '00000000-0000-4000-8000-000000000001',
        ordinal: 0,
        section_title: null,
        source_locator: 'page:1',
        content: [
          'show clock',
          'Syntax Description',
          'show',
          'Displays information.',
          'set system host-name edge-1'
        ].join('\n'),
        content_hash:
          'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
      }]
    })

    expect(result.handled_fragment_ids).toEqual([])
  })

  it('does not hide an unrecognized residual CLI command', () => {
    const result = networkCommandReferenceExtractor.extract({
      source: {
        canonical_url: 'https://vendor.example/residual-command-reference',
        document_type: 'command_reference',
        title: 'Residual command reference',
        document_version: null,
        document_date: null
      },
      context: {
        vendor_slug: 'cisco',
        operating_system_slug: 'ios-xe'
      },
      verified_at: '2026-08-26',
      fragments: [{
        id: '00000000-0000-4000-8000-000000000001',
        ordinal: 0,
        section_title: null,
        source_locator: 'page:1',
        content: [
          'show clock',
          'Syntax Description',
          'show',
          'Displays running system information.',
          'Command Mode',
          'Privileged EXEC',
          'vlan 10',
          'shutdown',
          'peer-address 10.0.0.1'
        ].join('\n'),
        content_hash:
          'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
      }]
    })

    expect(result.handled_fragment_ids).toEqual([])
  })
  it('maps Cisco, Junos, and EOS candidates to the core envelope', () => {
    for (const [vendor, operatingSystem] of [
      ['cisco', 'ios-xe'],
      ['juniper', 'junos'],
      ['arista', 'eos']
    ] as const) {
      const parsed = networkKnowledgeCandidateSchema.parse({
        ...candidate,
        stable_key: `${vendor}.${operatingSystem}.show-version`,
        vendor_slug: vendor,
        operating_system_slug: operatingSystem
      })
      expect(enforceCoreCandidatePolicy(
        networkDomainPack.toCoreCandidate(parsed),
      )).toMatchObject({
        domain_id: 'network',
        record_type: 'command',
        context: {
          vendor,
          operating_system: operatingSystem
        }
      })
    }
  })

  it('passes Domain Kit conformance', () => {
    expect(runDomainPackConformance(
      networkDomainPack,
      networkConformanceFixture,
    ).passed).toBe(true)
  })

  it('rejects records without operational content', () => {
    const parsed = networkKnowledgeCandidateSchema.parse({
      ...candidate,
      command: undefined,
      procedure: []
    })
    expect(networkDomainPack.validateCandidate(parsed)).toMatchObject({
      valid: false,
      issues: [{ code: 'NETWORK_CONTENT_REQUIRED' }]
    })
  })
})
