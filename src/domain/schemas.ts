import { z } from 'zod'

import { networkVersionSchema } from '../version.js'

const shortText = z.string().trim().min(1).max(240)
const boundedText = z.string().trim().min(1).max(2_000)

export const networkContextInputSchema = z.object({
  vendor: shortText.optional(),
  model: shortText.optional(),
  operating_system: shortText.optional(),
  version: networkVersionSchema.optional()
}).refine(
  (value) => value.vendor || value.model || value.operating_system,
  'At least one of vendor, model, or operating_system is required',
)

export type NetworkContextInput = z.infer<typeof networkContextInputSchema>

export const resolvedNetworkContextSchema = z.object({
  vendor: z.string(),
  vendor_slug: z.string(),
  model: z.string().nullable(),
  platform_slug: z.string().nullable(),
  operating_system: z.string(),
  operating_system_slug: z.string(),
  version: z.string().nullable(),
  applicable_version: z.string(),
  resolution_confidence: z.number().min(0).max(1),
  ambiguities: z.array(z.string())
})

export type ResolvedNetworkContext = z.infer<
  typeof resolvedNetworkContextSchema
>

export const queryKnowledgeInputSchema = z.object({
  question: boundedText.min(3),
  context: networkContextInputSchema,
  limit: z.number().int().min(1).max(5).default(3)
})

export const getWorkflowInputSchema = z.object({
  goal: boundedText.min(3),
  context: networkContextInputSchema,
  limit: z.number().int().min(1).max(3).default(1)
})

export const publicKnowledgeSchema = z.object({
  revision_ref: z.string().uuid(),
  kind: z.enum([
    'command',
    'workflow',
    'diagnostic',
    'concept',
    'change',
    'upgrade'
  ]),
  title: z.string(),
  summary: z.string(),
  applicability: z.object({
    vendor: z.string(),
    model: z.string().nullable(),
    operating_system: z.string(),
    versions: z.object({
      minimum: z.string().nullable(),
      maximum: z.string().nullable(),
      requested: z.string().nullable()
    })
  }),
  cli_mode: z.string().nullable(),
  command: z.string().nullable(),
  procedure: z.array(z.string()),
  prerequisites: z.array(z.string()),
  risks: z.array(z.string()),
  verification: z.array(z.string()),
  rollback: z.array(z.string()),
  last_verified_at: z.string(),
  confidence: z.number().min(0).max(1),
  quality_score: z.number().min(0).max(1),
  dangerous: z.boolean(),
  assurance: z.object({
    validation_level: z.enum([
      'documentation_reviewed',
      'batfish_modeled',
      'runtime_lab_validated'
    ]),
    independent_confirmations: z.number().int().min(1),
    confidence_explanation: z.string(),
    next_review_at: z.string(),
    lab_validated_at: z.string().nullable()
  }),
  conflicts: z.array(z.object({
    severity: z.enum(['informational', 'warning', 'blocking']),
    description: z.string()
  })),
  limitations: z.array(z.string())
})

export type PublicKnowledge = z.infer<typeof publicKnowledgeSchema>

export const knowledgeSearchResultSchema = z.object({
  context: resolvedNetworkContextSchema,
  answers: z.array(publicKnowledgeSchema),
  unknown: z.boolean(),
  next_action: z
    .enum(['use_answer', 'request_expert_answer'])
})

export const requestExpertAnswerInputSchema = z.object({
  question: boundedText.min(8),
  context: networkContextInputSchema
})

export const taskCredentialsSchema = z.object({
  task_id: z.string().regex(/^ekt_[A-Za-z0-9_-]{32}$/),
  access_token: z.string().min(32).max(128).optional()
})

export const continueTaskInputSchema = taskCredentialsSchema.extend({
  message: boundedText
})

export const taskStatusSchema = z.object({
  task_id: z.string(),
  status: z.enum([
    'queued',
    'claimed',
    'researching',
    'input_required',
    'validating',
    'completed',
    'failed',
    'cancelled',
    'expired'
  ]),
  created_at: z.string(),
  expires_at: z.string(),
  input_request: z.string().nullable(),
  answer: publicKnowledgeSchema.nullable(),
  failure: z.object({
    code: z.string(),
    message: z.string()
  }).nullable(),
  poll_after_ms: z.number().int()
  ,
  stage: z.enum([
    'queued',
    'researching',
    'conflict_check',
    'validating',
    'publishing',
    'completed',
    'failed',
    'cancelled'
  ]),
  progress_percent: z.number().int().min(0).max(100),
  milestones: z.array(z.object({
    stage: z.string(),
    progress_percent: z.number().int().min(0).max(100),
    message: z.string(),
    created_at: z.string()
  })),
  published_release_sequence: z.number().int().nullable()
})

export const createdTaskStatusSchema = taskStatusSchema.extend({
  access_token: z.string().min(32).max(128).optional()
})

export const feedbackInputSchema = z.object({
  revision_ref: z.string().uuid().optional(),
  task_id: z.string().regex(/^ekt_[A-Za-z0-9_-]{32}$/).optional(),
  access_token: z.string().min(32).max(128).optional(),
  rating: z.number().int().min(-1).max(1).optional(),
  category: z.enum([
    'correct',
    'incorrect',
    'outdated',
    'unsafe',
    'incomplete',
    'other'
  ]),
  comment: z.string().trim().min(1).max(2_000).optional(),
  sample_contribution: z.object({
    consent: z.literal(true),
    consent_version: z.literal('2026-07-01'),
    snapshot_type: z.enum([
      'show_version',
      'config',
      'log',
      'topology',
      'other'
    ]),
    sanitized_payload: z.string().min(1).refine(
      (value) => Buffer.byteLength(value, 'utf8') <= 16_384,
      'sanitized_payload must be no larger than 16 KiB',
    ),
    detected_context: z.record(z.string(), z.string()).optional()
  }).optional()
}).refine(
  (value) => value.revision_ref || value.task_id,
  'revision_ref or task_id is required',
)

export const feedbackOutputSchema = z.object({
  accepted: z.literal(true),
  feedback_id: z.string().uuid(),
  contribution_id: z.string().uuid().optional()
})

export const candidateRevisionSchema = z.object({
  task_id: z.string().regex(/^ekt_[A-Za-z0-9_-]{32}$/),
  lease_token: z.string().min(32).max(128),
  stable_key: z.string().regex(/^[a-z0-9][a-z0-9._-]{2,159}$/),
  kind: z.enum([
    'command',
    'workflow',
    'diagnostic',
    'concept',
    'change',
    'upgrade'
  ]),
  vendor_slug: z.string().regex(/^[a-z0-9][a-z0-9-]{1,62}$/),
  platform_slug: z.string().regex(/^[a-z0-9][a-z0-9-]{1,62}$/).optional(),
  operating_system_slug: z.string().regex(/^[a-z0-9][a-z0-9-]{1,62}$/),
  version_min: networkVersionSchema.optional(),
  version_max: networkVersionSchema.optional(),
  title: shortText,
  summary: z.string().trim().min(1).max(4_000),
  question_patterns: z.array(z.string().trim().min(3).max(300)).min(1).max(20),
  cli_mode: z.string().trim().min(1).max(120).optional(),
  command: z.string().trim().min(1).max(2_000).optional(),
  procedure: z.array(z.string().trim().min(1).max(1_000)).max(50).default([]),
  prerequisites: z.array(z.string().trim().min(1).max(1_000)).max(30).default([]),
  risks: z.array(z.string().trim().min(1).max(1_000)).max(30).default([]),
  verification: z.array(z.string().trim().min(1).max(1_000)).min(1).max(30),
  rollback: z.array(z.string().trim().min(1).max(1_000)).max(30).default([]),
  limitations: z.array(z.string().trim().min(1).max(1_000)).max(30).default([]),
  dangerous: z.boolean(),
  confidence: z.number().min(0).max(1),
  quality_score: z.number().min(0).max(1),
  confidence_reason: z.string().trim().min(10).max(2_000),
  last_verified_at: z.iso.date(),
  provenance: z.array(z.object({
    url: z.url().startsWith('https://'),
    document_type: z.string().trim().min(1).max(80),
    title: shortText,
    document_version: z.string().trim().max(120).optional(),
    document_date: z.iso.date().optional(),
    verified_at: z.iso.date(),
    content_hash: z.string().regex(/^sha256:[0-9a-f]{64}$/),
    evidence_fragment: z.string().trim().min(1).max(600),
    evidence_role: z.enum(['primary', 'corroborating', 'conflict']).default('primary')
  })).min(1).max(10)
})

export type CandidateRevision = z.infer<typeof candidateRevisionSchema>

const boundedSnapshot = z.string().min(1).refine(
  (value) => Buffer.byteLength(value, 'utf8') <= 65_536,
  'snapshot must be no larger than 64 KiB',
)

export const snapshotAnalysisInputSchema = z.object({
  snapshot: boundedSnapshot,
  snapshot_type: z.enum([
    'auto',
    'show_version',
    'config',
    'log',
    'topology',
    'other'
  ]).default('auto'),
  redaction_profile: z.enum(['secrets_only', 'strict']).default('strict')
})

export const snapshotAnalysisOutputSchema = z.object({
  context: z.object({
    vendor: z.string(),
    model: z.string().nullable(),
    operating_system: z.string(),
    version: z.string().nullable(),
    support_level: z.enum(['deep', 'recognized']),
    confidence: z.number().min(0).max(1),
    ambiguities: z.array(z.string())
  }).nullable(),
  snapshot_type: z.enum([
    'show_version',
    'config',
    'log',
    'topology',
    'other'
  ]),
  sanitized_snapshot: z.string(),
  redactions: z.array(z.object({
    type: z.string(),
    count: z.number().int().min(1)
  })),
  retention: z.literal('not_stored'),
  limitations: z.array(z.string())
})

export const changeReviewInputSchema = z.object({
  intent: boundedText.min(5),
  context: networkContextInputSchema,
  commands: z.array(z.string().trim().min(1).max(2_000)).max(100).optional(),
  config_diff: z.string().max(32_000).optional()
}).refine(
  (value) => (value.commands?.length ?? 0) > 0 || Boolean(value.config_diff),
  'commands or config_diff is required',
)

const verificationCheckSchema = z.object({
  id: z.string(),
  description: z.string(),
  required: z.boolean()
})

export const changeReviewOutputSchema = z.object({
  decision: z.enum([
    'allowed_with_checks',
    'manual_review_required',
    'blocked',
    'unknown'
  ]),
  risk_level: z.enum(['low', 'medium', 'high', 'critical']),
  blast_radius: z.array(z.string()),
  matched_rules: z.array(z.string()),
  unknown_commands: z.array(z.string()),
  prechecks: z.array(z.string()),
  stop_conditions: z.array(z.string()),
  verification_plan: z.array(verificationCheckSchema),
  rollback: z.array(z.string()),
  approval_required: z.boolean(),
  verification_token: z.string().nullable(),
  verification_token_expires_at: z.string().nullable(),
  limitations: z.array(z.string())
})

export const changeVerificationInputSchema = z.object({
  verification_token: z.string().min(40).max(16_000),
  before_snapshot: z.string().max(30_000),
  after_snapshot: z.string().max(30_000)
}).refine(
  (value) =>
    Buffer.byteLength(
      value.before_snapshot + value.after_snapshot,
      'utf8',
    ) <= 60_000,
  'combined snapshots must be no larger than 60 KiB',
)

export const changeVerificationOutputSchema = z.object({
  result: z.enum(['passed', 'failed', 'partial', 'indeterminate']),
  checks: z.array(z.object({
    id: z.string(),
    description: z.string(),
    status: z.enum(['passed', 'failed', 'indeterminate']),
    evidence: z.string()
  })),
  rollback_recommended: z.boolean(),
  next_action: z.string(),
  retention: z.literal('not_stored')
})

export const upgradeAdvisorInputSchema = z.object({
  model: shortText,
  operating_system: shortText.default('IOS XE'),
  current_version: networkVersionSchema,
  target_version: networkVersionSchema,
  enabled_features: z.array(shortText).max(30).default([])
})

export const upgradeAdvisorOutputSchema = z.object({
  status: z.enum(['supported_with_checks', 'blocked', 'unknown']),
  applicability: z.object({
    vendor: z.string(),
    model: z.string(),
    operating_system: z.string(),
    current_version: z.string(),
    target_version: z.string()
  }),
  breaking_changes: z.array(z.string()),
  security_advisories: z.array(z.object({
    id: z.string(),
    applicability: z.string(),
    disposition: z.string()
  })),
  prerequisites: z.array(z.string()),
  procedure: z.array(z.string()),
  verification: z.array(z.string()),
  rollback: z.array(z.string()),
  reload_expected: z.boolean().nullable(),
  next_action: z.enum(['use_advice', 'request_expert_answer']),
  assurance: z.object({
    validation_level: z.literal('documentation_reviewed'),
    last_verified_at: z.string(),
    confidence: z.number().min(0).max(1)
  }),
  limitations: z.array(z.string())
})

const topologySnapshotSchema = z.object({
  device_hint: z.string().trim().min(1).max(120),
  output_type: z.enum(['auto', 'cdp', 'lldp', 'route', 'traceroute']),
  content: z.string().min(1).max(16_000)
})

export const networkPathInputSchema = z.object({
  snapshots: z.array(topologySnapshotSchema).min(1).max(8),
  source: z.string().trim().max(120).optional(),
  destination: z.string().trim().max(120).optional()
}).refine(
  (value) =>
    Buffer.byteLength(
      value.snapshots.map((snapshot) => snapshot.content).join(''),
      'utf8',
    ) <= 60_000,
  'combined topology snapshots must be no larger than 60 KiB',
)

export const networkPathOutputSchema = z.object({
  nodes: z.array(z.object({
    id: z.string(),
    label: z.string(),
    kind: z.enum(['device', 'hop', 'network', 'unknown']),
    attributes: z.record(z.string(), z.string())
  })),
  edges: z.array(z.object({
    id: z.string(),
    source: z.string(),
    target: z.string(),
    local_interface: z.string().nullable(),
    remote_interface: z.string().nullable(),
    protocol: z.enum(['cdp', 'lldp', 'route', 'traceroute'])
  })),
  paths: z.array(z.object({
    source: z.string(),
    destination: z.string(),
    hops: z.array(z.string()),
    complete: z.boolean()
  })),
  probable_fault_domain: z.string().nullable(),
  findings: z.array(z.string()),
  unparsed_inputs: z.array(z.string()),
  retention: z.literal('not_stored'),
  limitations: z.array(z.string())
})
