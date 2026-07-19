import {
  enforceCoreCandidatePolicy,
  runDomainPackConformance
} from '@clideck/domain-kit'
import { describe, expect, it } from 'vitest'

import {
  networkConformanceFixture,
  networkDomainPack,
  networkKnowledgeCandidateSchema
} from './index.js'

const candidate = networkConformanceFixture.candidate

describe('Network Domain Pack', () => {
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
