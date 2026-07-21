import { createHash } from 'node:crypto'

import type { DatabaseClient } from '../db.js'
import {
  compareNormalizedVersions,
  normalizeVendorVersion
} from '../version.js'
import type { CandidateKnowledge } from './publication.js'

export type ApplicabilityScope =
  | 'model'
  | 'vendor_os'
  | 'architecture'
  | 'os_family'

export type PublicMatchLevel =
  | 'exact_model'
  | 'vendor_os'
  | 'architecture_os'
  | 'os_family'

export type VersionScope = 'exact' | 'range' | 'branch' | 'unbounded'

export type PublicVersionMatch =
  | 'exact'
  | 'explicit_range'
  | 'branch'
  | 'unbounded'
  | 'same_branch_fallback'

export type AssuranceLevel =
  | 'exact'
  | 'compatible'
  | 'generic'
  | 'best_effort'

export type SoftwareVersionStrategy =
  | 'vendor'
  | 'major_minor'
  | 'calendar'
  | 'semantic'
  | 'exact'

const portableFamilyByOperatingSystem: Readonly<Record<string, string>> = {
  onie: 'onie',
  sonic: 'sonic',
  openwrt: 'openwrt',
  'openwrt-gl-inet-firmware': 'openwrt',
  linux: 'linux-userspace',
  'linux-iproute2': 'linux-iproute2',
  'linux-netfilter': 'linux-netfilter',
  'cumulus-linux': 'cumulus-linux',
  'cumulus-linux-nvue': 'cumulus-linux',
  'nvidia-cumulus-linux': 'cumulus-linux'
}

function normalizedFamilySlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63)
}

export function knownSoftwareFamilySlug(
  vendorSlug: string,
  operatingSystemSlug: string,
): string | null {
  const portable = portableFamilyByOperatingSystem[operatingSystemSlug]
  if (portable) return portable
  if (operatingSystemSlug.includes('cumulus-linux')) return 'cumulus-linux'
  if (vendorSlug === 'cisco' && operatingSystemSlug === 'nx-os') {
    return 'cisco-nx-os'
  }
  if (vendorSlug === 'cisco' && operatingSystemSlug === 'ios-xe') {
    return 'cisco-ios-xe'
  }
  return null
}

export function deriveVersionBranch(
  version: string | null | undefined,
  strategy: SoftwareVersionStrategy,
): string | null {
  if (!version || strategy === 'exact') return null
  if (strategy === 'calendar') {
    if (/^\d{6,8}$/.test(version)) {
      return `${version.slice(0, 4)}.${version.slice(4, 6)}`
    }
  }
  const numeric = version.match(/\d+/g) ?? []
  if (numeric.length < 2) return null
  if (strategy === 'calendar') {
    return `${numeric[0]}.${numeric[1]}`
  }
  if (strategy === 'major_minor' || strategy === 'semantic') {
    return `${numeric[0]}.${numeric[1]}`
  }
  return null
}

export function matchVersionApplicability(input: {
  requested: string | null
  minimum: number[] | null
  maximum: number[] | null
  versionScope: VersionScope
  versionBranch: string | null
  versionStrategy: SoftwareVersionStrategy
}): PublicVersionMatch | null {
  const {
    requested,
    minimum,
    maximum,
    versionScope,
    versionBranch,
    versionStrategy
  } = input
  if (!requested) {
    return versionScope === 'unbounded' ? 'unbounded' : 'branch'
  }
  const normalized = normalizeVendorVersion(requested)
  if (versionScope === 'unbounded') return 'unbounded'
  if (versionScope === 'range') {
    if (minimum && compareNormalizedVersions(normalized, minimum) < 0) {
      return null
    }
    if (maximum && compareNormalizedVersions(normalized, maximum) > 0) {
      return null
    }
    return 'explicit_range'
  }
  if (versionScope === 'branch') {
    return deriveVersionBranch(requested, versionStrategy) === versionBranch
      ? 'branch'
      : null
  }
  if (
    minimum && maximum &&
    compareNormalizedVersions(normalized, minimum) === 0 &&
    compareNormalizedVersions(normalized, maximum) === 0
  ) {
    return 'exact'
  }
  const requestedBranch = deriveVersionBranch(requested, versionStrategy)
  return requestedBranch && requestedBranch === versionBranch
    ? 'same_branch_fallback'
    : null
}

export function assuranceFor(
  scope: ApplicabilityScope,
  versionMatch: PublicVersionMatch,
): AssuranceLevel {
  if (versionMatch === 'same_branch_fallback') return 'best_effort'
  if (scope === 'model' && versionMatch === 'exact') return 'exact'
  if (scope === 'os_family') return 'generic'
  return 'compatible'
}

export function publicMatchLevel(scope: ApplicabilityScope): PublicMatchLevel {
  if (scope === 'model') return 'exact_model'
  if (scope === 'vendor_os') return 'vendor_os'
  if (scope === 'architecture') return 'architecture_os'
  return 'os_family'
}

function semanticKey(candidate: CandidateKnowledge): Buffer {
  const executableIdentity = candidate.command ??
    (candidate.procedure.length > 0 ? candidate.procedure.join('\n') : null)
  const content = candidate.portable_key
    ? [candidate.kind, candidate.portable_key]
    : [candidate.kind, executableIdentity ?? candidate.title]
  const normalized = content.join('\0')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
  return createHash('sha256').update(normalized).digest()
}

function fallbackFamilySlug(vendorSlug: string, osSlug: string): string {
  const readable = normalizedFamilySlug(`${vendorSlug}-${osSlug}`)
  if (readable.length <= 55) return readable
  const suffix = createHash('sha256')
    .update(`${vendorSlug}\0${osSlug}`)
    .digest('hex')
    .slice(0, 7)
  return `${readable.slice(0, 55)}-${suffix}`
}

export async function indexPublishedKnowledgeApplicability(
  client: DatabaseClient,
  input: {
    revisionId: string
    operatingSystemId: string
    vendorId: string
    platformId: string | null
    candidate: CandidateKnowledge
  },
): Promise<void> {
  const { candidate } = input
  const desiredFamily = candidate.software_family_slug ??
    knownSoftwareFamilySlug(
      candidate.vendor_slug,
      candidate.operating_system_slug,
    ) ??
    fallbackFamilySlug(candidate.vendor_slug, candidate.operating_system_slug)
  const family = await client.query<{ id: string; version_strategy: SoftwareVersionStrategy }>(
    `INSERT INTO software_families (
       slug, display_name, portability_mode, version_strategy
     )
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (slug) DO UPDATE SET updated_at = now()
     RETURNING id, version_strategy`,
    [
      desiredFamily,
      desiredFamily.replace(/-/g, ' '),
      knownSoftwareFamilySlug(
        candidate.vendor_slug,
        candidate.operating_system_slug,
      ) ? 'portable' : 'vendor_specific',
      ['nx-os', 'ios-xe'].includes(candidate.operating_system_slug)
        ? 'major_minor'
        : 'vendor'
    ],
  )
  const familyRow = family.rows[0]!
  await client.query(
    `INSERT INTO operating_system_family_memberships (
       operating_system_id, family_id, membership_kind
     ) VALUES ($1, $2, 'native')
     ON CONFLICT DO NOTHING`,
    [input.operatingSystemId, familyRow.id],
  )
  const scope = candidate.applicability_scope ?? (
    input.platformId ? 'model' : 'vendor_os'
  )
  const versionScope = candidate.version_scope ?? (
    candidate.version_min && candidate.version_max
      ? candidate.version_min === candidate.version_max ? 'exact' : 'range'
      : 'unbounded'
  )
  const versionBranch = candidate.version_branch ?? (
    versionScope === 'exact'
      ? deriveVersionBranch(candidate.version_min, familyRow.version_strategy)
      : versionScope === 'branch'
        ? deriveVersionBranch(
            candidate.version_min ?? candidate.version_max,
            familyRow.version_strategy,
          )
        : null
  )
  const hardwareSensitive = candidate.dangerous || [
    'service_disruptive',
    'data_loss',
    'storage_wipe',
    'firmware_change',
    'boot_change',
    'factory_reset',
    'unknown'
  ].includes(candidate.risk_level ?? 'unknown')
  await client.query(
    `INSERT INTO knowledge_applicability_index (
       revision_id, family_id, scope_level, capability_slug,
       vendor_id, platform_id, architecture_slug,
       version_scope, version_branch, portable_semantic_key,
       requires_platform_confirmation, classifier_version,
       classification_source
     ) VALUES (
       $1, $2, $3, NULL, $4, $5, $6, $7, $8, $9,
       $10, 'portable-v1', 'publication'
     )
     ON CONFLICT (revision_id) DO UPDATE SET
       family_id = EXCLUDED.family_id,
       scope_level = EXCLUDED.scope_level,
       vendor_id = EXCLUDED.vendor_id,
       platform_id = EXCLUDED.platform_id,
       architecture_slug = EXCLUDED.architecture_slug,
       version_scope = EXCLUDED.version_scope,
       version_branch = EXCLUDED.version_branch,
       portable_semantic_key = EXCLUDED.portable_semantic_key,
       requires_platform_confirmation =
         EXCLUDED.requires_platform_confirmation,
       classifier_version = EXCLUDED.classifier_version,
       classification_source = EXCLUDED.classification_source,
       classified_at = now()`,
    [
      input.revisionId,
      familyRow.id,
      scope,
      scope === 'vendor_os' ? input.vendorId : null,
      scope === 'model' ? input.platformId : null,
      scope === 'architecture' ? candidate.architecture_slug ?? null : null,
      versionScope,
      versionBranch,
      semanticKey(candidate),
      scope !== 'model' && hardwareSensitive
    ],
  )
}
