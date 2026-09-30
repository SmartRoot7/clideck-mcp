import { describe, expect, it } from 'vitest'
import { networkAnswerMatchesFeatures, networkDemandFeatureTerms } from './answer-relevance.js'

describe('network learning evidence constraints', () => {
  it('rejects feature substitution and preserves plural and protocol aliases', () => {
    expect(networkAnswerMatchesFeatures('Inspect EVPN DF election', 'OSPFv3 interface priority')).toBe(false)
    expect(networkAnswerMatchesFeatures('Inspect VLAN configuration', 'Allowed VLANs on a trunk')).toBe(true)
    expect(networkDemandFeatureTerms('Check IS-IS and OSPFv3 neighbors')).toEqual(['ospf','isis'])
    expect(networkAnswerMatchesFeatures('Inspect MACsec state', 'remacsec-test')).toBe(false)
  })
  it('requires all explicitly requested features', () => {
    expect(networkAnswerMatchesFeatures('Inspect nftables flowtable offload', 'nftables rules')).toBe(false)
    expect(networkAnswerMatchesFeatures('Inspect nftables flowtable offload', 'nftables flowtable counters')).toBe(true)
  })
})
