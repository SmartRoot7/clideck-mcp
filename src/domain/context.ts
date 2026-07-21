import type { Database } from '../db.js'
import type {
  NetworkContextInput,
  ResolvedNetworkContext
} from './schemas.js'
import type { SoftwareVersionStrategy } from './applicability.js'

type ContextCandidate = {
  id: string
  slug: string
  display_name: string
  score: number
}

type FamilyCandidate = ContextCandidate & {
  portability_mode: 'portable' | 'vendor_specific'
  version_strategy: SoftwareVersionStrategy
}

const minimumVendorScore = 0.5
const minimumFamilyScore = 0.55

function normalizeAlias(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9._-]+/g, '')
}

function requestedSlug(value: string | undefined): string {
  const slug = value
    ?.toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63)
  return slug && slug.length >= 2 ? slug : 'not-specified'
}

async function resolveVendor(
  database: Database,
  input: NetworkContextInput,
): Promise<ContextCandidate | undefined> {
  const needle = input.vendor ?? input.model
  if (!needle) return undefined

  const result = await database.query<ContextCandidate>(
    `SELECT
       v.id,
       v.slug,
       v.display_name,
       greatest(
         CASE
           WHEN lower(v.slug) = lower($1) OR lower(v.display_name) = lower($1)
             THEN 1.0
           ELSE 0.0
         END,
         coalesce(max(similarity(ca.normalized_alias, $2)), 0.0),
         similarity(lower(v.display_name), lower($1))
       )::float8 AS score
     FROM vendors v
     LEFT JOIN context_aliases ca ON ca.vendor_id = v.id
     WHERE lower(v.slug) = lower($1)
        OR lower(v.display_name) = lower($1)
        OR ca.normalized_alias % $2
        OR similarity(lower(v.display_name), lower($1)) >= 0.3
     GROUP BY v.id
     ORDER BY score DESC, v.slug
     LIMIT 1`,
    [needle, normalizeAlias(needle)],
  )
  return result.rows[0]
}

async function resolvePlatform(
  database: Database,
  vendorId: string,
  model: string | undefined,
): Promise<ContextCandidate | undefined> {
  if (!model) return undefined
  const result = await database.query<ContextCandidate>(
    `SELECT
       p.id,
       p.slug,
       p.display_name,
       greatest(
         CASE
           WHEN lower(p.slug) = lower($2) OR lower(p.display_name) = lower($2)
             THEN 1.0
           ELSE 0.0
         END,
         coalesce(max(similarity(ca.normalized_alias, $3)), 0.0),
         similarity(lower(p.display_name), lower($2))
       )::float8 AS score
     FROM platforms p
     LEFT JOIN context_aliases ca ON ca.platform_id = p.id
     WHERE p.vendor_id = $1
       AND (
         lower(p.slug) = lower($2)
         OR lower(p.display_name) = lower($2)
         OR ca.normalized_alias % $3
         OR (p.model_pattern IS NOT NULL AND $2 ~* p.model_pattern)
       )
     GROUP BY p.id
     ORDER BY score DESC, p.slug
     LIMIT 1`,
    [vendorId, model, normalizeAlias(model)],
  )
  return result.rows[0]
}

async function resolveFamily(
  database: Database,
  operatingSystem: string,
): Promise<FamilyCandidate | undefined> {
  const normalized = normalizeAlias(operatingSystem)
  const result = await database.query<FamilyCandidate>(
    `SELECT
       family.id,
       family.slug,
       family.display_name,
       family.portability_mode,
       family.version_strategy,
       greatest(
         CASE
           WHEN lower(family.slug) = lower($1)
             OR lower(family.display_name) = lower($1)
             THEN 1.0
           ELSE 0.0
         END,
         coalesce(max(
           CASE
             WHEN alias.normalized_alias = $2 THEN 1.0
             ELSE similarity(alias.normalized_alias, $2)
           END
         ), 0.0)
       )::float8 AS score
     FROM software_families family
     LEFT JOIN software_family_aliases alias
       ON alias.family_id = family.id
     WHERE lower(family.slug) = lower($1)
        OR lower(family.display_name) = lower($1)
        OR alias.normalized_alias = $2
        OR alias.normalized_alias % $2
     GROUP BY family.id
     ORDER BY score DESC, family.slug
     LIMIT 1`,
    [operatingSystem, normalized],
  )
  return result.rows[0]
}

async function resolveVendorOperatingSystem(
  database: Database,
  vendorId: string,
  operatingSystem: string | undefined,
): Promise<ContextCandidate | undefined> {
  const result = await database.query<ContextCandidate>(
    `SELECT
       os.id,
       os.slug,
       os.display_name,
       greatest(
         CASE
           WHEN lower(os.slug) = lower(coalesce($2, os.slug))
             OR lower(os.display_name) = lower(coalesce($2, os.display_name))
             THEN CASE WHEN $2 IS NULL THEN 0.7 ELSE 1.0 END
           ELSE 0.0
         END,
         coalesce(max(similarity(ca.normalized_alias, $3)), 0.0)
       )::float8 AS score
     FROM operating_systems os
     LEFT JOIN context_aliases ca ON ca.operating_system_id = os.id
     WHERE os.vendor_id = $1
       AND (
         $2 IS NULL
         OR lower(os.slug) = lower($2)
         OR lower(os.display_name) = lower($2)
         OR ca.normalized_alias % $3
       )
     GROUP BY os.id
     ORDER BY score DESC, os.slug
     LIMIT 1`,
    [vendorId, operatingSystem ?? null, normalizeAlias(operatingSystem ?? '')],
  )
  return result.rows[0]
}

async function familyForOperatingSystem(
  database: Database,
  operatingSystemId: string,
): Promise<FamilyCandidate | undefined> {
  const result = await database.query<FamilyCandidate>(
    `SELECT
       family.id,
       family.slug,
       family.display_name,
       family.portability_mode,
       family.version_strategy,
       1::float8 AS score
     FROM operating_system_family_memberships membership
     JOIN software_families family ON family.id = membership.family_id
     WHERE membership.operating_system_id = $1
     ORDER BY
       CASE family.portability_mode WHEN 'portable' THEN 0 ELSE 1 END,
       family.slug
     LIMIT 1`,
    [operatingSystemId],
  )
  return result.rows[0]
}

async function familyIdsWithInheritance(
  database: Database,
  familyId: string,
): Promise<string[]> {
  const result = await database.query<{ id: string }>(
    `WITH RECURSIVE families(id) AS (
       SELECT $1::uuid
       UNION
       SELECT inheritance.parent_family_id
       FROM software_family_inheritance inheritance
       JOIN families ON families.id = inheritance.child_family_id
     )
     SELECT id FROM families`,
    [familyId],
  )
  return result.rows.map((row) => row.id)
}

export type InternalResolvedContext = ResolvedNetworkContext & {
  vendorId: string | null
  platformId: string | null
  operatingSystemId: string | null
  softwareFamilyId: string
  softwareFamilyIds: string[]
  softwareVersionStrategy: SoftwareVersionStrategy
  architectureSlug: string | null
}

export function publicNetworkContext(
  context: InternalResolvedContext,
): ResolvedNetworkContext {
  const {
    vendorId: _vendorId,
    platformId: _platformId,
    operatingSystemId: _operatingSystemId,
    softwareFamilyId: _softwareFamilyId,
    softwareFamilyIds: _softwareFamilyIds,
    softwareVersionStrategy: _softwareVersionStrategy,
    architectureSlug: _architectureSlug,
    ...publicContext
  } = context
  return publicContext
}

export async function resolveNetworkContext(
  database: Database,
  input: NetworkContextInput,
): Promise<InternalResolvedContext> {
  const vendor = await resolveVendor(database, input)
  const explicitFamily = input.operating_system
    ? await resolveFamily(database, input.operating_system)
    : undefined
  if (explicitFamily && explicitFamily.score < minimumFamilyScore) {
    throw new Error('NETWORK_CONTEXT_OS_NOT_RESOLVED')
  }
  if (
    (!vendor || vendor.score < minimumVendorScore) &&
    explicitFamily?.portability_mode !== 'portable'
  ) {
    throw new Error('NETWORK_CONTEXT_VENDOR_NOT_RESOLVED')
  }

  const platform = vendor && vendor.score >= minimumVendorScore
    ? await resolvePlatform(database, vendor.id, input.model)
    : undefined
  const vendorOperatingSystem = vendor && vendor.score >= minimumVendorScore
    ? await resolveVendorOperatingSystem(
        database,
        vendor.id,
        input.operating_system,
      )
    : undefined
  const family = explicitFamily ?? (
    vendorOperatingSystem
      ? await familyForOperatingSystem(database, vendorOperatingSystem.id)
      : undefined
  )
  if (!family || family.score < minimumFamilyScore) {
    throw new Error('NETWORK_CONTEXT_OS_NOT_RESOLVED')
  }
  if (
    family.portability_mode === 'vendor_specific' &&
    !vendorOperatingSystem
  ) {
    throw new Error('NETWORK_CONTEXT_OS_NOT_RESOLVED')
  }
  const architecture = platform
    ? await database.query<{ architecture_slug: string }>(
        `SELECT architecture_slug
         FROM platform_architectures
         WHERE platform_id = $1`,
        [platform.id],
      )
    : null
  const ambiguities: string[] = []
  if (input.vendor && (!vendor || vendor.score < minimumVendorScore)) {
    ambiguities.push(
      `Vendor "${input.vendor}" was not matched; portable OS knowledge may still apply`,
    )
  }
  if (input.model && !platform) {
    ambiguities.push(`Model "${input.model}" was not matched to a known platform`)
  }
  if (!input.version) {
    ambiguities.push('No software version was supplied; verify version applicability')
  }
  const familyIds = await familyIdsWithInheritance(database, family.id)
  return {
    vendorId: vendor?.score && vendor.score >= minimumVendorScore
      ? vendor.id
      : null,
    platformId: platform?.id ?? null,
    operatingSystemId: vendorOperatingSystem?.id ?? null,
    softwareFamilyId: family.id,
    softwareFamilyIds: familyIds,
    softwareVersionStrategy: family.version_strategy,
    architectureSlug: architecture?.rows[0]?.architecture_slug ?? null,
    vendor: vendor?.score && vendor.score >= minimumVendorScore
      ? vendor.display_name
      : input.vendor ?? 'Not specified',
    vendor_slug: vendor?.score && vendor.score >= minimumVendorScore
      ? vendor.slug
      : requestedSlug(input.vendor),
    model: platform?.display_name ?? input.model ?? null,
    platform_slug: platform?.slug ?? null,
    operating_system: family.display_name,
    operating_system_slug: vendorOperatingSystem?.slug ?? family.slug,
    software_family: family.display_name,
    software_family_slug: family.slug,
    portable_operating_system: family.portability_mode === 'portable',
    vendor_resolved: Boolean(
      vendor?.score && vendor.score >= minimumVendorScore
    ),
    model_resolved: Boolean(platform),
    version: input.version ?? null,
    applicable_version: input.version
      ? `Requested version ${input.version}`
      : 'Version not supplied',
    resolution_confidence: Math.min(
      vendor?.score && vendor.score >= minimumVendorScore ? vendor.score : 0.6,
      platform?.score ?? (input.model ? 0.6 : 0.7),
      family.score,
    ),
    ambiguities
  }
}
