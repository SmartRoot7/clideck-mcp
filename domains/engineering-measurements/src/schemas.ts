import {
  coreProvenanceSchema,
  coreRiskLevelSchema
} from '@clideck/domain-kit'
import { z } from 'zod'

import { exactDecimalSchema } from './decimal.js'

export const engineeringDimensionSchema = z.enum([
  'length',
  'temperature',
  'pressure',
  'force',
  'mass',
  'time',
  'frequency',
  'ratio'
])

export const engineeringUnitSchema = z.enum([
  'mm',
  'cm',
  'm',
  'in',
  'ft',
  'degC',
  'K',
  'Pa',
  'kPa',
  'MPa',
  'psi',
  'N',
  'kN',
  'g',
  'kg',
  'ms',
  's',
  'Hz',
  'rpm',
  'percent',
  'unitless'
])

export const engineeringContextSchema = z.strictObject({
  discipline: z.string().trim().min(2).max(80),
  quantity: z.string().trim().min(1).max(120),
  material: z.string().trim().min(1).max(120).optional(),
  system: z.string().trim().min(1).max(120).optional(),
  conditions: z.array(
    z.string().trim().min(1).max(240),
  ).max(12).default([])
})

const exactValueSchema = z.strictObject({
  value: exactDecimalSchema,
  unit: engineeringUnitSchema
})

export const engineeringToleranceSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('bounds'),
    lower: exactDecimalSchema,
    upper: exactDecimalSchema,
    unit: engineeringUnitSchema
  }),
  z.strictObject({
    type: z.literal('plus_minus'),
    minus: exactDecimalSchema,
    plus: exactDecimalSchema,
    unit: engineeringUnitSchema
  })
])

const measurementPayloadSchema = z.strictObject({
  type: z.literal('measurement'),
  dimension: engineeringDimensionSchema,
  measured: exactValueSchema,
  tolerance: engineeringToleranceSchema.optional(),
  method: z.string().trim().min(1).max(500),
  conditions: z.array(z.string().trim().min(1).max(240)).max(12).default([])
})

const tolerancePayloadSchema = z.strictObject({
  type: z.literal('tolerance'),
  dimension: engineeringDimensionSchema,
  nominal: exactValueSchema,
  tolerance: engineeringToleranceSchema,
  method: z.string().trim().min(1).max(500),
  conditions: z.array(z.string().trim().min(1).max(240)).max(12).default([])
})

const procedurePayloadSchema = z.strictObject({
  type: z.literal('procedure'),
  steps: z.array(z.string().trim().min(1).max(1_000)).min(1).max(40),
  equipment: z.array(z.string().trim().min(1).max(240)).max(20).default([]),
  expected_result: z.string().trim().min(1).max(1_000)
})

const conversionPayloadSchema = z.strictObject({
  type: z.literal('conversion'),
  dimension: engineeringDimensionSchema,
  input_unit: engineeringUnitSchema,
  output_unit: engineeringUnitSchema,
  factor: exactDecimalSchema,
  offset: exactDecimalSchema.default('0'),
  formula: z.string().trim().min(3).max(500)
})

export const engineeringPayloadSchema = z.discriminatedUnion('type', [
  measurementPayloadSchema,
  tolerancePayloadSchema,
  procedurePayloadSchema,
  conversionPayloadSchema
])

const commonCandidateShape = {
  stable_key: z.string().regex(/^[a-z0-9][a-z0-9._-]{2,159}$/),
  context: engineeringContextSchema,
  title: z.string().trim().min(1).max(240),
  summary: z.string().trim().min(1).max(4_000),
  question_patterns: z.array(
    z.string().trim().min(3).max(300),
  ).min(1).max(20),
  prerequisites: z.array(z.string().trim().min(1).max(1_000)).max(30)
    .default([]),
  risks: z.array(z.string().trim().min(1).max(1_000)).max(30).default([]),
  verification: z.array(
    z.string().trim().min(1).max(1_000),
  ).min(1).max(30),
  rollback: z.array(z.string().trim().min(1).max(1_000)).max(30).default([]),
  limitations: z.array(z.string().trim().min(1).max(1_000)).max(30)
    .default([]),
  dangerous: z.boolean().default(false),
  risk_level: coreRiskLevelSchema.default('safe_read_only'),
  confidence: z.number().min(0).max(1),
  quality_score: z.number().min(0).max(1),
  confidence_reason: z.string().trim().min(10).max(2_000),
  last_verified_at: z.iso.date(),
  provenance: z.array(coreProvenanceSchema).min(1).max(10)
}

export const engineeringCandidateSchema = z.strictObject({
  ...commonCandidateShape,
  record_type: z.enum([
    'measurement',
    'tolerance',
    'procedure',
    'conversion'
  ]),
  payload: engineeringPayloadSchema
}).superRefine((candidate, context) => {
  if (candidate.record_type !== candidate.payload.type) {
    context.addIssue({
      code: 'custom',
      path: ['payload', 'type'],
      message: 'record_type must match payload.type.'
    })
  }
})

export const engineeringPublicRecordSchema = z.strictObject({
  record_type: z.enum([
    'measurement',
    'tolerance',
    'procedure',
    'conversion'
  ]),
  title: z.string(),
  summary: z.string(),
  context: engineeringContextSchema,
  payload: engineeringPayloadSchema,
  verification: z.array(z.string()),
  limitations: z.array(z.string()),
  confidence: z.number().min(0).max(1),
  quality_score: z.number().min(0).max(1),
  last_verified_at: z.iso.date()
})

export type EngineeringContext = z.infer<typeof engineeringContextSchema>
export type EngineeringCandidate = z.infer<typeof engineeringCandidateSchema>
export type EngineeringPayload = z.infer<typeof engineeringPayloadSchema>
export type EngineeringPublicRecord = z.infer<
  typeof engineeringPublicRecordSchema
>
