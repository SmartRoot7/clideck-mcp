import { describe, expect, it } from 'vitest'

import {
  assessKnowledgeDemandRelevance,
  isRelevantToKnowledgeDemand,
  knowledgeDemandTerms
} from '../src/domain/knowledge-demand-relevance.js'

describe('knowledge-demand relevance', () => {
  const macsecQuestion =
    'Diagnose MACsec MKA rekey failure on a Cisco Catalyst 9300 running IOS XE 17.15.5'

  it('keeps technical demand terms while removing vendor, model and generic wording', () => {
    expect(knowledgeDemandTerms(macsecQuestion)).toEqual(
      expect.arrayContaining(['macsec', 'mka', 'rekey']),
    )
    expect(knowledgeDemandTerms(macsecQuestion)).not.toEqual(
      expect.arrayContaining(['cisco', 'catalyst', 'ios', 'failure']),
    )
  })

  it('rejects a product-matched but feature-unrelated source', () => {
    const relevance = assessKnowledgeDemandRelevance(macsecQuestion, [
      'Cisco Catalyst 9300 IOS XE configuration reference for interface counters.',
      'This chapter covers generic interface configuration and show commands.'
    ])
    expect(relevance.terms.length).toBeGreaterThan(0)
    expect(relevance.matchedTerms).toEqual([])
    expect(isRelevantToKnowledgeDemand(macsecQuestion, [
      'Cisco Catalyst 9300 IOS XE configuration reference for interface counters.'
    ])).toBe(false)
  })

  it('accepts an exact feature term without matching a substring', () => {
    expect(isRelevantToKnowledgeDemand(macsecQuestion, [
      'MACsec MKA key-server and rekey troubleshooting for Catalyst switches.'
    ])).toBe(true)
    expect(isRelevantToKnowledgeDemand(macsecQuestion, [
      'The remacsec-test command is unrelated.'
    ])).toBe(false)
  })

  it('keeps ordinary operational terms usable for concrete network questions', () => {
    const vlanQuestion = 'Safely add VLAN 200 to an existing trunk without replacing allowed VLANs'
    expect(knowledgeDemandTerms(vlanQuestion)).toEqual(
      expect.arrayContaining(['vlan', 'trunk']),
    )
    expect(isRelevantToKnowledgeDemand(vlanQuestion, [
      'Adding VLANs to an interface trunk allowed list.'
    ])).toBe(true)
  })
})
