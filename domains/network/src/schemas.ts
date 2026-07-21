import { z } from 'zod'

const slugSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{1,62}$/)
const versionSchema = z.string().trim().min(1).max(64).regex(
  /^[A-Za-z0-9][A-Za-z0-9()._\-/]*$/,
)
const boundedLine = z.string().trim().min(1).max(1_000)

export const networkContextSchema = z.strictObject({
  vendor: slugSchema.optional(),
  model: slugSchema.optional(),
  operating_system: slugSchema,
  version: versionSchema.optional()
})

export const networkRiskLevelSchema = z.enum([
  'safe_read_only',
  'changes_config',
  'credential_sensitive',
  'service_disruptive',
  'data_loss',
  'storage_wipe',
  'firmware_change',
  'boot_change',
  'factory_reset',
  'unknown'
])

export const networkKnowledgeCandidateSchema = z.strictObject({
  stable_key: z.string().regex(/^[a-z0-9][a-z0-9._-]{2,159}$/),
  kind: z.enum([
    'command',
    'workflow',
    'diagnostic',
    'concept',
    'change',
    'upgrade'
  ]),
  vendor_slug: slugSchema,
  platform_slug: slugSchema.optional(),
  operating_system_slug: slugSchema,
  version_min: versionSchema.optional(),
  version_max: versionSchema.optional(),
  software_family_slug: slugSchema.optional(),
  applicability_scope: z.enum([
    'model', 'vendor_os', 'architecture', 'os_family'
  ]).optional(),
  architecture_slug: slugSchema.optional(),
  version_scope: z.enum([
    'exact', 'range', 'branch', 'unbounded'
  ]).optional(),
  version_branch: versionSchema.optional(),
  portable_key: z.string()
    .regex(/^[a-z0-9][a-z0-9._-]{2,159}$/)
    .optional(),
  title: z.string().trim().min(1).max(240),
  summary: z.string().trim().min(1).max(4_000),
  question_patterns: z.array(
    z.string().trim().min(3).max(300),
  ).min(1).max(20),
  cli_mode: z.string().trim().min(1).max(120).optional(),
  command: z.string().trim().min(1).max(2_000).optional(),
  procedure: z.array(boundedLine).max(50).default([]),
  prerequisites: z.array(boundedLine).max(30).default([]),
  risks: z.array(boundedLine).max(30).default([]),
  verification: z.array(boundedLine).min(1).max(30),
  rollback: z.array(boundedLine).max(30).default([]),
  limitations: z.array(boundedLine).max(30).default([]),
  dangerous: z.boolean(),
  risk_level: networkRiskLevelSchema.optional(),
  confidence: z.number().min(0).max(1),
  quality_score: z.number().min(0).max(1),
  confidence_reason: z.string().trim().min(10).max(2_000),
  last_verified_at: z.iso.date(),
  provenance: z.array(z.strictObject({
    url: z.url().startsWith('https://'),
    document_type: z.string().trim().min(1).max(80),
    title: z.string().trim().min(1).max(240),
    document_version: z.string().trim().min(1).max(120).optional(),
    document_date: z.iso.date().optional(),
    verified_at: z.iso.date(),
    content_hash: z.string().regex(/^sha256:[0-9a-f]{64}$/),
    evidence_fragment: z.string().trim().min(1).max(600),
    evidence_role: z.enum([
      'primary',
      'corroborating',
      'conflict'
    ]).default('primary')
  })).min(1).max(10)
})

export const networkPublicRecordSchema = z.strictObject({
  record_type: z.enum([
    'command',
    'workflow',
    'diagnostic',
    'concept',
    'change',
    'upgrade'
  ]),
  title: z.string(),
  summary: z.string(),
  applicability: z.strictObject({
    vendor: z.string(),
    model: z.string().nullable(),
    operating_system: z.string(),
    version_min: z.string().nullable(),
    version_max: z.string().nullable(),
    match_level: z.enum([
      'exact_model', 'vendor_os', 'architecture_os', 'os_family'
    ]).optional(),
    version_match: z.enum([
      'exact', 'explicit_range', 'branch', 'unbounded',
      'same_branch_fallback'
    ]).optional(),
    assurance_level: z.enum([
      'exact', 'compatible', 'generic', 'best_effort'
    ]).optional(),
    requires_platform_confirmation: z.boolean().optional()
  }),
  content: z.strictObject({
    cli_mode: z.string().nullable(),
    command: z.string().nullable(),
    procedure: z.array(z.string())
  }),
  prerequisites: z.array(z.string()),
  risks: z.array(z.string()),
  verification: z.array(z.string()),
  rollback: z.array(z.string()),
  limitations: z.array(z.string()),
  dangerous: z.boolean(),
  confidence: z.number().min(0).max(1),
  quality_score: z.number().min(0).max(1)
})

export type NetworkContext = z.infer<typeof networkContextSchema>
export type NetworkKnowledgeCandidate = z.infer<
  typeof networkKnowledgeCandidateSchema
>
export type NetworkPublicRecord = z.infer<
  typeof networkPublicRecordSchema
>
