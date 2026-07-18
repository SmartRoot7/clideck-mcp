import type { Database } from '../db.js'
import type {
  NetworkContextInput,
  ResolvedNetworkContext
} from './schemas.js'

type ContextCandidate = {
  id: string
  slug: string
  display_name: string
  score: number
}

async function resolveVendor(
  database: Database,
  input: NetworkContextInput,
): Promise<ContextCandidate | undefined> {
  const needle = input.vendor ?? input.model ?? input.operating_system
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
         coalesce(max(similarity(ca.normalized_alias, lower(regexp_replace($1, '[^[:alnum:]._-]+', '', 'g')))), 0.0),
         similarity(lower(v.display_name), lower($1))
       )::float8 AS score
     FROM vendors v
     LEFT JOIN context_aliases ca ON ca.vendor_id = v.id
     WHERE lower(v.slug) = lower($1)
        OR lower(v.display_name) = lower($1)
        OR ca.normalized_alias % lower(regexp_replace($1, '[^[:alnum:]._-]+', '', 'g'))
        OR similarity(lower(v.display_name), lower($1)) >= 0.3
     GROUP BY v.id
     ORDER BY score DESC, v.slug
     LIMIT 1`,
    [needle],
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
         coalesce(max(similarity(ca.normalized_alias, lower(regexp_replace($2, '[^[:alnum:]._-]+', '', 'g')))), 0.0),
         similarity(lower(p.display_name), lower($2))
       )::float8 AS score
     FROM platforms p
     LEFT JOIN context_aliases ca ON ca.platform_id = p.id
     WHERE p.vendor_id = $1
       AND (
         lower(p.slug) = lower($2)
         OR lower(p.display_name) = lower($2)
         OR ca.normalized_alias % lower(regexp_replace($2, '[^[:alnum:]._-]+', '', 'g'))
         OR (p.model_pattern IS NOT NULL AND $2 ~* p.model_pattern)
       )
     GROUP BY p.id
     ORDER BY score DESC, p.slug
     LIMIT 1`,
    [vendorId, model],
  )
  return result.rows[0]
}

async function resolveOperatingSystem(
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
         coalesce(max(similarity(ca.normalized_alias, lower(regexp_replace(coalesce($2, ''), '[^[:alnum:]._-]+', '', 'g')))), 0.0)
       )::float8 AS score
     FROM operating_systems os
     LEFT JOIN context_aliases ca ON ca.operating_system_id = os.id
     WHERE os.vendor_id = $1
       AND (
         $2 IS NULL
         OR lower(os.slug) = lower($2)
         OR lower(os.display_name) = lower($2)
         OR ca.normalized_alias % lower(regexp_replace($2, '[^[:alnum:]._-]+', '', 'g'))
       )
     GROUP BY os.id
     ORDER BY score DESC, os.slug
     LIMIT 1`,
    [vendorId, operatingSystem ?? null],
  )
  return result.rows[0]
}

export type InternalResolvedContext = ResolvedNetworkContext & {
  vendorId: string
  platformId: string | null
  operatingSystemId: string
}

export async function resolveNetworkContext(
  database: Database,
  input: NetworkContextInput,
): Promise<InternalResolvedContext> {
  const vendor = await resolveVendor(database, input)
  if (!vendor || vendor.score < 0.3) {
    throw new Error('NETWORK_CONTEXT_VENDOR_NOT_RESOLVED')
  }

  const [platform, operatingSystem] = await Promise.all([
    resolvePlatform(database, vendor.id, input.model),
    resolveOperatingSystem(database, vendor.id, input.operating_system)
  ])

  if (!operatingSystem || operatingSystem.score < 0.3) {
    throw new Error('NETWORK_CONTEXT_OS_NOT_RESOLVED')
  }

  const ambiguities: string[] = []
  if (input.model && !platform) {
    ambiguities.push(`Model "${input.model}" was not matched to a known platform`)
  }
  if (!input.version) {
    ambiguities.push('No software version was supplied; verify version applicability')
  }

  return {
    vendorId: vendor.id,
    platformId: platform?.id ?? null,
    operatingSystemId: operatingSystem.id,
    vendor: vendor.display_name,
    vendor_slug: vendor.slug,
    model: platform?.display_name ?? input.model ?? null,
    platform_slug: platform?.slug ?? null,
    operating_system: operatingSystem.display_name,
    operating_system_slug: operatingSystem.slug,
    version: input.version ?? null,
    applicable_version: input.version
      ? `Requested version ${input.version}`
      : 'Version not supplied',
    resolution_confidence: Math.min(
      vendor.score,
      platform?.score ?? 0.7,
      operatingSystem.score,
    ),
    ambiguities
  }
}
