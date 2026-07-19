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
        content: 'Privileged EXEC\nshow interfaces status',
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
