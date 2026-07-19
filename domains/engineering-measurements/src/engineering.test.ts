import {
  enforceCoreCandidatePolicy,
  runDomainPackConformance
} from '@clideck/domain-kit'
import { describe, expect, it } from 'vitest'

import {
  ENGINEERING_MEASUREMENT_SAMPLES,
  compareExactDecimals,
  conformanceFixture,
  engineeringCandidateSchema,
  engineeringMeasurementsPack
} from './index.js'

describe('Engineering Measurements Domain Pack', () => {
  it('compares exact decimals without floating point conversion', () => {
    expect(compareExactDecimals('1.000', '1')).toBe(0)
    expect(compareExactDecimals('0.1000000000000000001', '0.1')).toBe(1)
    expect(compareExactDecimals('-0.001', '0')).toBe(-1)
  })

  it('validates every project-authored sample', () => {
    expect(ENGINEERING_MEASUREMENT_SAMPLES).toHaveLength(16)
    for (const sample of ENGINEERING_MEASUREMENT_SAMPLES) {
      const parsed = engineeringCandidateSchema.parse(sample)
      expect(engineeringMeasurementsPack.validateCandidate(parsed)).toEqual({
        valid: true,
        issues: []
      })
      expect(enforceCoreCandidatePolicy(
        engineeringMeasurementsPack.toCoreCandidate(parsed),
      ).domain_id).toBe('engineering-measurements')
    }
  })

  it('rejects reversed bounds and incompatible units', () => {
    const parsed = engineeringCandidateSchema.parse({
      ...ENGINEERING_MEASUREMENT_SAMPLES[5],
      payload: {
        type: 'tolerance',
        dimension: 'length',
        nominal: { value: '10.0', unit: 'mm' },
        tolerance: {
          type: 'bounds',
          lower: '11.0',
          upper: '9.0',
          unit: 'psi'
        },
        method: 'Invalid regression fixture.',
        conditions: []
      }
    })
    const codes = engineeringMeasurementsPack
      .validateCandidate(parsed)
      .issues
      .map((issue) => issue.code)
    expect(codes).toContain('ENGINEERING_UNIT_DIMENSION_MISMATCH')
    expect(codes).toContain('ENGINEERING_NOMINAL_OUTSIDE_TOLERANCE')
    expect(codes).toContain('ENGINEERING_TOLERANCE_BOUNDS_REVERSED')
  })

  it('passes Domain Kit conformance', () => {
    expect(runDomainPackConformance(
      engineeringMeasurementsPack,
      conformanceFixture,
    ).passed).toBe(true)
  })
})
