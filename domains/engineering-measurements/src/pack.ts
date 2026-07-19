import type {
  CorePublicKnowledgeRevision,
  DomainPack,
  DomainValidationIssue
} from '@clideck/domain-kit'
import { jsonObjectSchema } from '@clideck/domain-kit'

import {
  compareExactDecimals,
  isNonnegativeDecimal
} from './decimal.js'
import {
  engineeringCandidateSchema,
  engineeringContextSchema,
  engineeringPublicRecordSchema,
  type EngineeringCandidate,
  type EngineeringContext,
  type EngineeringPayload,
  type EngineeringPublicRecord
} from './schemas.js'

const unitsByDimension = {
  length: new Set(['mm', 'cm', 'm', 'in', 'ft']),
  temperature: new Set(['degC', 'K']),
  pressure: new Set(['Pa', 'kPa', 'MPa', 'psi']),
  force: new Set(['N', 'kN']),
  mass: new Set(['g', 'kg']),
  time: new Set(['ms', 's']),
  frequency: new Set(['Hz', 'rpm']),
  ratio: new Set(['percent', 'unitless'])
} as const

function validateUnit(
  dimension: keyof typeof unitsByDimension,
  unit: string,
  path: string,
  issues: DomainValidationIssue[],
): void {
  if (!unitsByDimension[dimension].has(unit as never)) {
    issues.push({
      code: 'ENGINEERING_UNIT_DIMENSION_MISMATCH',
      message: `${unit} is not valid for ${dimension}.`,
      path
    })
  }
}

function validateTolerance(
  payload: Extract<
    EngineeringPayload,
    { type: 'measurement' | 'tolerance' }
  >,
  issues: DomainValidationIssue[],
): void {
  const tolerance = payload.tolerance
  if (!tolerance) return
  const nominal = payload.type === 'measurement'
    ? payload.measured
    : payload.nominal
  validateUnit(
    payload.dimension,
    nominal.unit,
    'payload.nominal.unit',
    issues,
  )
  validateUnit(
    payload.dimension,
    tolerance.unit,
    'payload.tolerance.unit',
    issues,
  )
  if (nominal.unit !== tolerance.unit) {
    issues.push({
      code: 'ENGINEERING_TOLERANCE_UNIT_MISMATCH',
      message: 'Tolerance and nominal values must use the same unit.',
      path: 'payload.tolerance.unit'
    })
  }
  if (tolerance.type === 'bounds') {
    if (
      compareExactDecimals(tolerance.lower, nominal.value) > 0 ||
      compareExactDecimals(nominal.value, tolerance.upper) > 0
    ) {
      issues.push({
        code: 'ENGINEERING_NOMINAL_OUTSIDE_TOLERANCE',
        message: 'Nominal value must be within lower and upper bounds.',
        path: 'payload.tolerance'
      })
    }
    if (compareExactDecimals(tolerance.lower, tolerance.upper) > 0) {
      issues.push({
        code: 'ENGINEERING_TOLERANCE_BOUNDS_REVERSED',
        message: 'Lower tolerance bound cannot exceed upper bound.',
        path: 'payload.tolerance'
      })
    }
  } else if (
    !isNonnegativeDecimal(tolerance.minus) ||
    !isNonnegativeDecimal(tolerance.plus)
  ) {
    issues.push({
      code: 'ENGINEERING_NEGATIVE_PLUS_MINUS',
      message: 'Plus/minus tolerance magnitudes must be nonnegative.',
      path: 'payload.tolerance'
    })
  }
}

export const engineeringMeasurementsManifest = {
  schema_version: '1' as const,
  id: 'engineering-measurements',
  version: '1.0.0',
  display_name: 'Engineering Measurements',
  description:
    'Exact engineering values, units, tolerances, conversions, and verification procedures.',
  core_compatibility: { minimum: '1.0.0', maximum: '1.0.0' },
  context_dimensions: [
    { key: 'discipline', display_name: 'Discipline', description: 'Engineering discipline.', value_type: 'string' as const, required: true },
    { key: 'quantity', display_name: 'Quantity', description: 'Measured or controlled quantity.', value_type: 'string' as const, required: true },
    { key: 'material', display_name: 'Material', description: 'Applicable material.', value_type: 'string' as const, required: false },
    { key: 'system', display_name: 'System', description: 'Applicable component or system.', value_type: 'string' as const, required: false },
    { key: 'conditions', display_name: 'Conditions', description: 'Environmental or test conditions.', value_type: 'json' as const, required: false }
  ],
  record_types: [
    { id: 'measurement', display_name: 'Measurement', description: 'An exact observed or reference value.' },
    { id: 'tolerance', display_name: 'Tolerance', description: 'A nominal value with explicit allowed bounds.' },
    { id: 'procedure', display_name: 'Procedure', description: 'A reproducible measurement procedure.' },
    { id: 'conversion', display_name: 'Conversion', description: 'An exact unit conversion rule.' }
  ],
  capabilities: {
    search: true,
    workflows: true,
    continuous_learning: false,
    artifacts: false,
    spatial: false,
    relations: false,
    lab_validation: true
  }
}

export const engineeringMeasurementsPack: DomainPack<
  EngineeringContext,
  EngineeringCandidate,
  EngineeringPublicRecord
> = {
  manifest: engineeringMeasurementsManifest,
  contextSchema: engineeringContextSchema,
  candidateSchema: engineeringCandidateSchema,
  publicRecordSchema: engineeringPublicRecordSchema,
  normalizeContext(input) {
    return engineeringContextSchema.parse(input)
  },
  validateCandidate(candidate) {
    const issues: DomainValidationIssue[] = []
    const payload = candidate.payload
    if (payload.type === 'measurement' || payload.type === 'tolerance') {
      validateTolerance(payload, issues)
    } else if (payload.type === 'conversion') {
      validateUnit(
        payload.dimension,
        payload.input_unit,
        'payload.input_unit',
        issues,
      )
      validateUnit(
        payload.dimension,
        payload.output_unit,
        'payload.output_unit',
        issues,
      )
      if (compareExactDecimals(payload.factor, '0') <= 0) {
        issues.push({
          code: 'ENGINEERING_CONVERSION_FACTOR_NONPOSITIVE',
          message: 'Conversion factor must be greater than zero.',
          path: 'payload.factor'
        })
      }
    }
    if (candidate.dangerous && candidate.risk_level === 'safe_read_only') {
      issues.push({
        code: 'ENGINEERING_DANGEROUS_FALSE_SAFE',
        message: 'Dangerous procedures cannot be safe_read_only.',
        path: 'risk_level'
      })
    }
    return { valid: issues.length === 0, issues }
  },
  toCoreCandidate(candidate) {
    const context = {
      discipline: candidate.context.discipline,
      quantity: candidate.context.quantity,
      ...(candidate.context.material
        ? { material: candidate.context.material }
        : {}),
      ...(candidate.context.system
        ? { system: candidate.context.system }
        : {}),
      conditions: candidate.context.conditions
    }
    return {
      domain_id: 'engineering-measurements',
      schema_version: engineeringMeasurementsManifest.schema_version,
      stable_key: candidate.stable_key,
      record_type: candidate.record_type,
      title: candidate.title,
      summary: candidate.summary,
      question_patterns: candidate.question_patterns,
      context: jsonObjectSchema.parse(context),
      payload: jsonObjectSchema.parse(candidate.payload),
      prerequisites: candidate.prerequisites,
      risks: candidate.risks,
      verification: candidate.verification,
      rollback: candidate.rollback,
      limitations: candidate.limitations,
      dangerous: candidate.dangerous,
      risk_level: candidate.risk_level,
      confidence: candidate.confidence,
      quality_score: candidate.quality_score,
      confidence_reason: candidate.confidence_reason,
      last_verified_at: candidate.last_verified_at,
      provenance: candidate.provenance
    }
  },
  fromCoreRevision(revision: CorePublicKnowledgeRevision) {
    return engineeringPublicRecordSchema.parse({
      record_type: revision.record_type,
      title: revision.title,
      summary: revision.summary,
      context: revision.context,
      payload: revision.payload,
      verification: revision.verification,
      limitations: revision.limitations,
      confidence: revision.confidence,
      quality_score: revision.quality_score,
      last_verified_at: revision.last_verified_at
    })
  }
}
