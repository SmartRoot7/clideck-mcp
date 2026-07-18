import { describe, expect, it } from 'vitest'

import {
  compactNumber,
  duration,
  numberOf,
  shortId,
  titleCase,
  toneFor
} from './format'

describe('metric formatting', () => {
  it('normalizes PostgreSQL numeric values without NaN', () => {
    expect(numberOf('56798')).toBe(56_798)
    expect(numberOf('not-a-number')).toBe(0)
    expect(compactNumber('56798')).toBe('56.8K')
  })

  it('keeps readable business labels and secondary identifiers', () => {
    expect(titleCase('candidate_verification')).toBe('Candidate Verification')
    expect(shortId('12345678-1234-1234-1234-123456789012')).toBe(
      '12345678…789012',
    )
    expect(duration(125_000)).toBe('2m 5s')
  })

  it('maps operational states to consistent semantic tones', () => {
    expect(toneFor('completed')).toBe('good')
    expect(toneFor('manual_review')).toBe('warning')
    expect(toneFor('failed')).toBe('danger')
  })
})
