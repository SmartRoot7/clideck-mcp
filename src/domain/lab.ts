import { createHash } from 'node:crypto'

import { z } from 'zod'

export const labValidationSchema = z.object({
  stable_key: z.string().min(3).max(200),
  revision_hash: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  validation_type: z.enum([
    'documentation_reviewed',
    'batfish_modeled',
    'runtime_lab_validated'
  ]),
  fixture_key: z.string().regex(/^[a-z0-9._-]{3,120}$/),
  tool_version: z.string().min(1).max(120),
  status: z.enum(['passed', 'failed']),
  summary: z.string().min(1).max(1000),
  executed_at: z.iso.datetime(),
  expires_at: z.iso.datetime(),
  runtime_vendor: z.string().min(1).max(80).optional(),
  runtime_image_tested: z.boolean().optional(),
  details: z.record(z.string(), z.unknown()).default({})
})

const labCheckSchema = z.object({
  check_type: z.enum([
    'batfish_parse',
    'batfish_differential_reachability',
    'containerlab_runtime_parser'
  ]),
  status: z.enum(['passed', 'failed']),
  summary: z.string().min(1).max(1000),
  details: z.record(z.string(), z.unknown()).default({})
})

const unsignedLabReportSchema = z.object({
  schema_version: z.literal(1),
  commit_sha: z.string().regex(/^[0-9a-f]{40}$/),
  generated_at: z.iso.datetime(),
  validations: z.array(labValidationSchema).max(500),
  checks: z.array(labCheckSchema).min(1).max(500)
})

export const labReportSchema = unsignedLabReportSchema.extend({
  report_hash: z.string().regex(/^sha256:[0-9a-f]{64}$/)
})

export type UnsignedLabReport = z.infer<typeof unsignedLabReportSchema>
export type LabReport = z.infer<typeof labReportSchema>

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)]),
    )
  }
  return value
}

export const labRevisionBindingSchema = z.object({
  stable_key: z.string().min(3).max(200),
  kind: z.string().min(1).max(80),
  version_min: z.string().nullable(),
  version_max: z.string().nullable(),
  title: z.string(),
  summary: z.string(),
  question_patterns: z.array(z.string()),
  cli_mode: z.string().nullable(),
  command_text: z.string().nullable(),
  procedure_steps: z.array(z.string()),
  prerequisites: z.array(z.string()),
  risks: z.array(z.string()),
  verification_steps: z.array(z.string()),
  rollback_steps: z.array(z.string()),
  limitations: z.array(z.string()),
  dangerous: z.boolean()
})

export function labRevisionHash(input: unknown): string {
  const binding = labRevisionBindingSchema.parse(input)
  return `sha256:${createHash('sha256')
    .update(JSON.stringify(canonicalize(binding)))
    .digest('hex')}`
}

export function labReportHash(report: UnsignedLabReport): string {
  const serialized = JSON.stringify(canonicalize(report))
  return `sha256:${createHash('sha256').update(serialized).digest('hex')}`
}

export function finalizeLabReport(input: unknown): LabReport {
  const unsigned = unsignedLabReportSchema.parse(input)
  return {
    ...unsigned,
    report_hash: labReportHash(unsigned)
  }
}

export function verifyLabReport(input: unknown): LabReport {
  const report = labReportSchema.parse(input)
  const { report_hash: suppliedHash, ...unsigned } = report
  if (labReportHash(unsigned) !== suppliedHash) {
    throw new Error('LAB_REPORT_HASH_MISMATCH')
  }
  for (const validation of report.validations) {
    const executedAt = Date.parse(validation.executed_at)
    const expiresAt = Date.parse(validation.expires_at)
    if (expiresAt <= Date.now() || expiresAt <= executedAt) {
      throw new Error('LAB_VALIDATION_EXPIRED')
    }
    if (
      validation.validation_type === 'runtime_lab_validated' &&
      (!validation.runtime_image_tested || !validation.runtime_vendor)
    ) {
      throw new Error('RUNTIME_VALIDATION_REQUIRES_TESTED_IMAGE')
    }
    if (
      validation.validation_type === 'runtime_lab_validated' &&
      validation.stable_key.startsWith('cisco.') &&
      validation.runtime_vendor?.toLowerCase() !== 'cisco'
    ) {
      throw new Error('CISCO_RUNTIME_VALIDATION_REQUIRES_CISCO_IMAGE')
    }
  }
  return report
}
