import {
  enforceCoreCandidatePolicy,
  runDomainPackConformance
} from '@clideck/domain-kit'
import { describe, expect, it } from 'vitest'

import {
  networkDomainPack,
  networkKnowledgeCandidateSchema
} from './index.js'

const candidate = {
  stable_key: 'cisco.ios-xe.show-version',
  kind: 'command' as const,
  vendor_slug: 'cisco',
  platform_slug: 'catalyst-9300',
  operating_system_slug: 'ios-xe',
  version_min: '17.9.1',
  version_max: '17.15.5',
  title: 'Display IOS XE software and hardware details',
  summary: 'Read-only device identity and software information.',
  question_patterns: ['How do I show the IOS XE version?'],
  cli_mode: 'privileged EXEC',
  command: 'show version',
  procedure: [],
  prerequisites: ['Privileged EXEC access.'],
  risks: [],
  verification: ['Confirm the expected model and version are displayed.'],
  rollback: [],
  limitations: ['Output varies by IOS XE release.'],
  dangerous: false,
  risk_level: 'safe_read_only' as const,
  confidence: 0.98,
  quality_score: 0.97,
  confidence_reason: 'Project-authored regression fixture with exact syntax.',
  last_verified_at: '2026-07-18',
  provenance: [{
    url: 'https://mcp.clideck.com/demo-data/network-regression.json',
    document_type: 'project_fixture',
    title: 'CliDeck network regression fixture',
    verified_at: '2026-07-18',
    content_hash: `sha256:${'b'.repeat(64)}`,
    evidence_fragment: 'The read-only command is show version.',
    evidence_role: 'primary' as const
  }]
}

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
    expect(runDomainPackConformance(networkDomainPack, {
      context: {
        vendor: 'cisco',
        model: 'catalyst-9300',
        operating_system: 'ios-xe',
        version: '17.15.5'
      },
      candidate
    }).passed).toBe(true)
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
