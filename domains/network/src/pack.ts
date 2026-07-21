import type {
  CorePublicKnowledgeRevision,
  CoreRiskLevel,
  DomainPack,
  DomainValidationResult
} from '@clideck/domain-kit'

import {
  networkContextSchema,
  networkKnowledgeCandidateSchema,
  networkPublicRecordSchema,
  type NetworkContext,
  type NetworkKnowledgeCandidate,
  type NetworkPublicRecord
} from './schemas.js'
import { networkCommandReferenceExtractor } from './fast-extractor.js'

const networkRiskToCoreRisk = {
  safe_read_only: 'safe_read_only',
  changes_config: 'changes_state',
  credential_sensitive: 'credential_sensitive',
  service_disruptive: 'service_disruptive',
  data_loss: 'data_loss',
  storage_wipe: 'data_loss',
  firmware_change: 'service_disruptive',
  boot_change: 'service_disruptive',
  factory_reset: 'data_loss',
  unknown: 'unknown'
} as const satisfies Record<
  NonNullable<NetworkKnowledgeCandidate['risk_level']>,
  CoreRiskLevel
>

export const networkDomainManifest = {
  schema_version: '1' as const,
  id: 'network',
  version: '1.0.0',
  display_name: 'Network Knowledge',
  description:
    'Version-aware commands, diagnostics, workflows, changes, and upgrades for network infrastructure.',
  core_compatibility: {
    minimum: '1.0.0',
    maximum: '1.0.0'
  },
  context_dimensions: [
    {
      key: 'vendor',
      display_name: 'Vendor',
      description: 'Equipment vendor.',
      value_type: 'string' as const,
      required: false
    },
    {
      key: 'model',
      display_name: 'Model',
      description: 'Device model or product family.',
      value_type: 'string' as const,
      required: false
    },
    {
      key: 'operating_system',
      display_name: 'Operating system',
      description: 'Network operating system.',
      value_type: 'string' as const,
      required: true
    },
    {
      key: 'version',
      display_name: 'Version',
      description: 'Vendor-specific software version.',
      value_type: 'string' as const,
      required: false
    },
    {
      key: 'runtime_mode',
      display_name: 'Runtime mode',
      description: 'Installer, rescue, recovery, update, or normal runtime.',
      value_type: 'string' as const,
      required: false
    },
    {
      key: 'shell_environment',
      display_name: 'Shell environment',
      description: 'The command environment, for example BusyBox.',
      value_type: 'string' as const,
      required: false
    }
  ],
  record_types: [
    { id: 'command', display_name: 'Command', description: 'A version-scoped command.' },
    { id: 'workflow', display_name: 'Workflow', description: 'A multi-step operational workflow.' },
    { id: 'diagnostic', display_name: 'Diagnostic', description: 'A diagnostic procedure or interpretation.' },
    { id: 'concept', display_name: 'Concept', description: 'A bounded technical concept.' },
    { id: 'change', display_name: 'Change', description: 'A guarded configuration change.' },
    { id: 'upgrade', display_name: 'Upgrade', description: 'A model and version-specific upgrade procedure.' }
  ],
  capabilities: {
    search: true,
    workflows: true,
    continuous_learning: true,
    artifacts: false,
    spatial: false,
    relations: true,
    lab_validation: true
  }
}

function validationResult(
  candidate: NetworkKnowledgeCandidate,
): DomainValidationResult {
  const issues: DomainValidationResult['issues'] = []
  if (!candidate.command && candidate.procedure.length === 0) {
    issues.push({
      code: 'NETWORK_CONTENT_REQUIRED',
      message: 'A network record requires a command or procedure.',
      path: 'command'
    })
  }
  if (
    candidate.dangerous &&
    candidate.risk_level === 'safe_read_only'
  ) {
    issues.push({
      code: 'NETWORK_DANGEROUS_FALSE_SAFE',
      message: 'Dangerous network knowledge cannot be safe_read_only.',
      path: 'risk_level'
    })
  }
  if (candidate.applicability_scope === 'model' && !candidate.platform_slug) {
    issues.push({
      code: 'NETWORK_MODEL_SCOPE_REQUIRES_PLATFORM',
      message: 'Model applicability requires a platform slug.',
      path: 'platform_slug'
    })
  }
  if (
    candidate.applicability_scope === 'architecture' &&
    !candidate.architecture_slug
  ) {
    issues.push({
      code: 'NETWORK_ARCHITECTURE_SCOPE_REQUIRES_ARCHITECTURE',
      message: 'Architecture applicability requires an architecture slug.',
      path: 'architecture_slug'
    })
  }
  if (candidate.version_scope === 'branch' && !candidate.version_branch) {
    issues.push({
      code: 'NETWORK_BRANCH_SCOPE_REQUIRES_BRANCH',
      message: 'Branch applicability requires a version branch.',
      path: 'version_branch'
    })
  }
  return { valid: issues.length === 0, issues }
}

export const networkDomainPack: DomainPack<
  NetworkContext,
  NetworkKnowledgeCandidate,
  NetworkPublicRecord
> = {
  manifest: networkDomainManifest,
  contextSchema: networkContextSchema,
  candidateSchema: networkKnowledgeCandidateSchema,
  publicRecordSchema: networkPublicRecordSchema,
  deterministicExtractor: networkCommandReferenceExtractor,
  searchContext: {
    hardKeys: ['operating_system']
  },
  normalizeContext(input) {
    return networkContextSchema.parse(input)
  },
  validateCandidate(candidate) {
    return validationResult(candidate)
  },
  toCoreCandidate(candidate) {
    const riskLevel = candidate.risk_level ?? (
      candidate.dangerous ? 'changes_config' : 'safe_read_only'
    )
    return {
      domain_id: 'network',
      schema_version: networkDomainManifest.schema_version,
      stable_key: candidate.stable_key,
      record_type: candidate.kind,
      title: candidate.title,
      summary: candidate.summary,
      question_patterns: candidate.question_patterns,
      context: {
        vendor: candidate.vendor_slug,
        ...(candidate.platform_slug
          ? { model: candidate.platform_slug }
          : {}),
        operating_system: candidate.operating_system_slug,
        ...(candidate.version_min
          ? { version_min: candidate.version_min }
          : {}),
        ...(candidate.version_max
          ? { version_max: candidate.version_max }
          : {}),
        ...(candidate.software_family_slug
          ? { software_family: candidate.software_family_slug }
          : {}),
        ...(candidate.applicability_scope
          ? { applicability_scope: candidate.applicability_scope }
          : {}),
        ...(candidate.architecture_slug
          ? { architecture: candidate.architecture_slug }
          : {}),
        ...(candidate.version_scope
          ? { version_scope: candidate.version_scope }
          : {}),
        ...(candidate.version_branch
          ? { version_branch: candidate.version_branch }
          : {}),
        ...(candidate.portable_key
          ? { portable_key: candidate.portable_key }
          : {}),
        ...(candidate.capability_slug
          ? { capability: candidate.capability_slug }
          : {}),
        ...(candidate.runtime_modes
          ? { runtime_modes: candidate.runtime_modes }
          : {}),
        ...(candidate.shell_environments
          ? { shell_environments: candidate.shell_environments }
          : {})
      },
      payload: {
        ...(candidate.cli_mode ? { cli_mode: candidate.cli_mode } : {}),
        ...(candidate.command ? { command: candidate.command } : {}),
        procedure: candidate.procedure
      },
      prerequisites: candidate.prerequisites,
      risks: candidate.risks,
      verification: candidate.verification,
      rollback: candidate.rollback,
      limitations: candidate.limitations,
      dangerous: candidate.dangerous,
      risk_level: networkRiskToCoreRisk[riskLevel],
      confidence: candidate.confidence,
      quality_score: candidate.quality_score,
      confidence_reason: candidate.confidence_reason,
      last_verified_at: candidate.last_verified_at,
      provenance: candidate.provenance
    }
  },
  fromCoreRevision(revision: CorePublicKnowledgeRevision) {
    const context = revision.context
    const payload = revision.payload
    return networkPublicRecordSchema.parse({
      record_type: revision.record_type,
      title: revision.title,
      summary: revision.summary,
      applicability: {
        vendor: context['vendor'],
        model: context['model'] ?? null,
        operating_system: context['operating_system'],
        version_min: context['version_min'] ?? null,
        version_max: context['version_max'] ?? null
      },
      content: {
        cli_mode: payload['cli_mode'] ?? null,
        command: payload['command'] ?? null,
        procedure: payload['procedure'] ?? []
      },
      prerequisites: revision.prerequisites,
      risks: revision.risks,
      verification: revision.verification,
      rollback: revision.rollback,
      limitations: revision.limitations,
      dangerous: revision.dangerous,
      confidence: revision.confidence,
      quality_score: revision.quality_score
    })
  }
}
