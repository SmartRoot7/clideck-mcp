import { describe, expect, it } from 'vitest'
import { networkAnswerMatchesFeatures, networkDemandFeatureTerms, networkDemandFeaturePatterns } from './answer-relevance.js'

describe('network learning evidence constraints', () => {
  it('rejects feature substitution and preserves plural and protocol aliases', () => {
    expect(networkAnswerMatchesFeatures('Inspect EVPN DF election', 'OSPFv3 interface priority')).toBe(false)
    expect(networkAnswerMatchesFeatures('Inspect VLAN configuration', 'Allowed VLANs on a trunk')).toBe(true)
    expect(networkDemandFeatureTerms('Check IS-IS and OSPFv3 neighbors')).toEqual(['ospf','isis'])
    expect(networkAnswerMatchesFeatures('Inspect MACsec state', 'remacsec-test')).toBe(false)
    expect(new RegExp(networkDemandFeaturePatterns('Inspect VLAN config')[0]!, 'i').test('Allowed VLANs')).toBe(true)
    expect(new RegExp(networkDemandFeaturePatterns('Inspect OSPFv3 state')[0]!, 'i').test('OSPFv3 interface')).toBe(true)
  })
  it('requires all explicitly requested features', () => {
    expect(networkAnswerMatchesFeatures('Inspect nftables flowtable offload', 'nftables rules')).toBe(false)
    expect(networkAnswerMatchesFeatures('Inspect nftables flowtable offload', 'nftables flowtable counters')).toBe(true)
  })
  it('distinguishes reverse path filtering from reverse-path forwarding and retains RPF aliases', () => {
    expect(networkAnswerMatchesFeatures('Identify Linux reverse path filtering mode', 'Permit established reverse-path connections')).toBe(false)
    expect(networkAnswerMatchesFeatures('Identify Linux reverse path filtering mode', 'Read net.ipv4.conf.eth0.rp_filter')).toBe(true)
    expect(networkAnswerMatchesFeatures('Inspect RPF mode', 'Reverse-path filtering settings')).toBe(true)
    expect(networkDemandFeatureTerms('Inspect XDP redirect failures')).toEqual(['xdp'])
  })
})
