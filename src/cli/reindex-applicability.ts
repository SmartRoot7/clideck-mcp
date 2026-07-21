import { createHash } from 'node:crypto'

import type { DatabaseClient } from '../db.js'
import { createCliRuntime } from './runtime.js'

const classifierVersion = 'portable-v2'
const dryRun = process.argv.includes('--dry-run')
const verify = process.argv.includes('--verify')
const resume = process.argv.includes('--resume')
const batchSize = 2_000

type OperatingSystemRow = {
  id: string
  os_slug: string
  os_name: string
  vendor_slug: string
  vendor_name: string
  family_count: number
}

type VendorRow = {
  id: string
  slug: string
  display_name: string
}

function fallbackFamilySlug(vendor: string, operatingSystem: string): string {
  const readable = `${vendor}-${operatingSystem}`
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  if (readable.length <= 55) return readable
  const suffix = createHash('sha256')
    .update(`${vendor}\0${operatingSystem}`)
    .digest('hex')
    .slice(0, 7)
  return `${readable.slice(0, 55).replace(/-+$/g, '')}-${suffix}`
}

async function ensureVendorSpecificFamilies(
  client: DatabaseClient,
): Promise<void> {
  const operatingSystems = await client.query<OperatingSystemRow>(
    `SELECT
       os.id,
       os.slug AS os_slug,
       os.display_name AS os_name,
       vendor.slug AS vendor_slug,
       vendor.display_name AS vendor_name,
       count(membership.family_id)::int AS family_count
     FROM operating_systems os
     JOIN vendors vendor ON vendor.id = os.vendor_id
     LEFT JOIN operating_system_family_memberships membership
       ON membership.operating_system_id = os.id
     GROUP BY os.id, vendor.id
     ORDER BY vendor.slug, os.slug`,
  )
  for (const operatingSystem of operatingSystems.rows) {
    if (operatingSystem.family_count > 0) continue
    const slug = fallbackFamilySlug(
      operatingSystem.vendor_slug,
      operatingSystem.os_slug,
    )
    const family = await client.query<{ id: string }>(
      `INSERT INTO software_families (
         slug, display_name, portability_mode, version_strategy
       ) VALUES ($1, $2, 'vendor_specific', 'vendor')
       ON CONFLICT (slug) DO UPDATE SET updated_at = now()
       RETURNING id`,
      [slug, `${operatingSystem.vendor_name} ${operatingSystem.os_name}`],
    )
    const familyId = family.rows[0]!.id
    await client.query(
      `INSERT INTO operating_system_family_memberships (
         operating_system_id, family_id, membership_kind
       ) VALUES ($1, $2, 'native')
       ON CONFLICT DO NOTHING`,
      [operatingSystem.id, familyId],
    )
    await client.query(
      `INSERT INTO software_family_aliases (family_id, alias)
       VALUES ($1, $2)
       ON CONFLICT (family_id, normalized_alias) DO NOTHING`,
      [familyId, operatingSystem.os_slug],
    )
  }
}

async function ensureVendorLevelFamilies(
  client: DatabaseClient,
): Promise<void> {
  const vendors = await client.query<VendorRow>(
    `SELECT DISTINCT vendor.id, vendor.slug, vendor.display_name
     FROM knowledge_revisions revision
     JOIN knowledge_items item ON item.id = revision.knowledge_item_id
     JOIN vendors vendor ON vendor.id = revision.vendor_id
     WHERE item.domain_id = 'network'
       AND revision.domain_id = 'network'
       AND revision.operating_system_id IS NULL
     ORDER BY vendor.slug`,
  )
  for (const vendor of vendors.rows) {
    const slug = fallbackFamilySlug(vendor.slug, 'vendor-level')
    const family = await client.query<{ id: string }>(
      `INSERT INTO software_families (
         slug, display_name, portability_mode, version_strategy
       ) VALUES ($1, $2, 'vendor_specific', 'vendor')
       ON CONFLICT (slug) DO UPDATE SET updated_at = now()
       RETURNING id`,
      [slug, `${vendor.display_name} vendor-level`],
    )
    await client.query(
      `INSERT INTO vendor_software_families (vendor_id, family_id)
       VALUES ($1, $2)
       ON CONFLICT (vendor_id) DO UPDATE SET family_id = excluded.family_id`,
      [vendor.id, family.rows[0]!.id],
    )
  }
}

async function rebuildIndexBatch(
  client: DatabaseClient,
  afterRevisionId: string | null,
): Promise<{ processed: number; lastRevisionId: string | null }> {
  const result = await client.query<{
    processed: number
    last_revision_id: string | null
  }>(
    `WITH target_revisions AS MATERIALIZED (
       SELECT revision.id
       FROM knowledge_revisions revision
       JOIN knowledge_items item ON item.id = revision.knowledge_item_id
       WHERE item.domain_id = 'network'
         AND revision.domain_id = 'network'
         AND ($2::uuid IS NULL OR revision.id > $2)
       ORDER BY revision.id
       LIMIT $3
     ), classified AS (
       SELECT
         revision.id AS revision_id,
         family.id AS family_id,
         CASE
           WHEN os.id IS NULL THEN 'vendor_os'
           WHEN os.slug = 'onie'
             AND vendor.slug = 'open-compute-project'
             THEN 'os_family'
           WHEN os.slug = 'sonic'
             AND vendor.slug IN ('sonic', 'sonic-project')
             AND (platform.id IS NULL OR platform.slug LIKE 'sonic%')
             THEN 'os_family'
           WHEN (os.slug = 'openwrt' OR os.slug LIKE 'openwrt-%')
             AND vendor.slug = 'openwrt-project'
             THEN 'os_family'
           WHEN os.slug IN ('linux', 'linux-iproute2', 'linux-netfilter')
             AND vendor.slug IN (
               'ethtool', 'haproxy', 'linux-man-pages', 'lvm',
               'multipath-tools', 'open-vswitch', 'systemd-networkd'
             )
             THEN 'os_family'
           WHEN os.slug LIKE '%cumulus-linux%'
             AND vendor.slug IN (
               'nvidia', 'nvidia-cumulus', 'nvidia-networking'
             )
             AND (
               platform.id IS NULL OR platform.slug LIKE 'cumulus-linux%'
             )
             THEN 'os_family'
           WHEN platform.id IS NOT NULL THEN 'model'
           ELSE 'vendor_os'
         END AS scope_level,
         CASE
           WHEN os.slug = 'linux-iproute2' THEN 'iproute2'
           WHEN os.slug = 'linux-netfilter' THEN 'netfilter'
           WHEN os.slug = 'linux' THEN 'linux-userspace'
           ELSE NULL
         END AS capability_slug,
         vendor.id AS vendor_id,
         platform.id AS platform_id,
         architecture.architecture_slug,
         CASE
           WHEN revision.version_min IS NULL
             AND revision.version_max IS NULL THEN 'unbounded'
           WHEN revision.version_min IS NOT NULL
             AND revision.version_min = revision.version_max THEN 'exact'
           ELSE 'range'
         END AS version_scope,
         CASE
           WHEN family.version_strategy = 'calendar'
             AND coalesce(revision.version_min, revision.version_max)
               ~ '^[0-9]{6,8}$'
             THEN substring(
               coalesce(revision.version_min, revision.version_max)
               FROM 1 FOR 4
             ) || '.' || substring(
               coalesce(revision.version_min, revision.version_max)
               FROM 5 FOR 2
             )
           WHEN family.version_strategy IN (
             'major_minor', 'calendar', 'semantic'
           ) THEN substring(
             coalesce(revision.version_min, revision.version_max)
             FROM '([0-9]+[.][0-9]+)'
           )
           ELSE NULL
         END AS version_branch,
         digest(
           lower(regexp_replace(concat_ws(
             E'\\x1f', item.kind,
             coalesce(
               nullif(revision.command_text, ''),
               CASE
                 WHEN revision.procedure_steps <> '[]'::jsonb
                   THEN revision.procedure_steps::text
                 ELSE revision.title
               END
             )
           ), '[[:space:]]+', ' ', 'g')),
           'sha256'
         ) AS portable_semantic_key,
         revision.dangerous OR revision.risk_level IN (
           'service_disruptive', 'data_loss', 'storage_wipe',
           'firmware_change', 'boot_change', 'factory_reset', 'unknown'
         ) AS hardware_sensitive
       FROM knowledge_revisions revision
       JOIN target_revisions target ON target.id = revision.id
       JOIN knowledge_items item ON item.id = revision.knowledge_item_id
       JOIN vendors vendor ON vendor.id = revision.vendor_id
       LEFT JOIN platforms platform ON platform.id = revision.platform_id
       LEFT JOIN platform_architectures architecture
         ON architecture.platform_id = platform.id
       LEFT JOIN operating_systems os ON os.id = revision.operating_system_id
       JOIN LATERAL (
         SELECT candidates.*
         FROM (
           SELECT selected_family.*
           FROM operating_system_family_memberships membership
           JOIN software_families selected_family
             ON selected_family.id = membership.family_id
           WHERE membership.operating_system_id = os.id
           UNION ALL
           SELECT vendor_family.*
           FROM vendor_software_families mapping
           JOIN software_families vendor_family
             ON vendor_family.id = mapping.family_id
           WHERE os.id IS NULL
             AND mapping.vendor_id = vendor.id
         ) candidates
         ORDER BY
           CASE candidates.portability_mode
             WHEN 'portable' THEN 0 ELSE 1
           END,
           candidates.slug
         LIMIT 1
       ) family ON true
       WHERE item.domain_id = 'network'
         AND revision.domain_id = 'network'
     ), upserted AS (
     INSERT INTO knowledge_applicability_index (
       revision_id, family_id, scope_level, capability_slug,
       vendor_id, platform_id, architecture_slug,
       version_scope, version_branch, portable_semantic_key,
       requires_platform_confirmation, classifier_version,
       classification_source
     )
     SELECT
       revision_id,
       family_id,
       scope_level,
       capability_slug,
       CASE WHEN scope_level = 'vendor_os' THEN vendor_id ELSE NULL END,
       CASE WHEN scope_level = 'model' THEN platform_id ELSE NULL END,
       CASE
         WHEN scope_level = 'architecture' THEN architecture_slug ELSE NULL
       END,
       version_scope,
       version_branch,
       portable_semantic_key,
       scope_level <> 'model' AND hardware_sensitive,
       $1,
       'deterministic_backfill'
     FROM classified
     ON CONFLICT (revision_id) DO UPDATE SET
       family_id = EXCLUDED.family_id,
       scope_level = EXCLUDED.scope_level,
       capability_slug = EXCLUDED.capability_slug,
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
       classified_at = now()
     RETURNING revision_id
     )
     SELECT
       count(*)::int AS processed,
       max(revision_id::text) AS last_revision_id
     FROM upserted`,
    [classifierVersion, afterRevisionId, batchSize],
  )
  return {
    processed: Number(result.rows[0]?.processed ?? 0),
    lastRevisionId: result.rows[0]?.last_revision_id ?? null
  }
}

const { database, logger } = createCliRuntime()
let runId: string | null = null
try {
  const expected = await database.query<{ count: number }>(
    `SELECT count(*)::int AS count
     FROM knowledge_revisions
     WHERE domain_id = 'network'`,
  )
  if (dryRun) {
    const selected = await database.query<{
      family: string
      active_records: number
    }>(
      `SELECT
         CASE
           WHEN os.slug = 'onie' THEN 'onie'
           WHEN os.slug = 'sonic' THEN 'sonic'
           WHEN os.slug = 'openwrt' OR os.slug LIKE 'openwrt-%'
             THEN 'openwrt'
           WHEN os.slug IN ('linux', 'linux-iproute2', 'linux-netfilter')
             THEN 'linux'
           WHEN os.slug LIKE '%cumulus-linux%' THEN 'cumulus-linux'
           ELSE 'vendor-specific'
         END AS family,
         count(*)::int AS active_records
       FROM active_knowledge_state active
       JOIN knowledge_revisions revision ON revision.id = active.revision_id
       JOIN operating_systems os ON os.id = revision.operating_system_id
       GROUP BY family
       ORDER BY family`,
    )
    logger.info({
      revisions_expected: expected.rows[0]?.count ?? 0,
      breakdown: selected.rows
    }, 'Applicability reindex dry run complete')
  } else {
    const expectedCount = Number(expected.rows[0]?.count ?? 0)
    const setupClient = await database.connect()
    let lastRevisionId: string | null = null
    try {
      await setupClient.query('BEGIN')
      const resumable = resume
        ? await setupClient.query<{
            id: string
            last_revision_id: string | null
          }>(
            `SELECT id, last_revision_id
             FROM applicability_reindex_runs
             WHERE classifier_version = $1
               AND revisions_expected = $2
               AND status IN ('running', 'failed')
             ORDER BY started_at DESC
             LIMIT 1
             FOR UPDATE`,
            [classifierVersion, expectedCount],
          )
        : { rows: [] }
      const resumed = resumable.rows[0]
      if (resumed) {
        runId = resumed.id
        lastRevisionId = resumed.last_revision_id
        await setupClient.query(
          `UPDATE applicability_reindex_runs
           SET status = 'running', completed_at = NULL, last_error = NULL
           WHERE id = $1`,
          [runId],
        )
      } else {
        const run = await setupClient.query<{ id: string }>(
          `INSERT INTO applicability_reindex_runs (
             classifier_version, status, revisions_expected
           ) VALUES ($1, 'running', $2)
           RETURNING id`,
          [classifierVersion, expectedCount],
        )
        runId = run.rows[0]!.id
      }
      await ensureVendorSpecificFamilies(setupClient)
      await ensureVendorLevelFamilies(setupClient)
      await setupClient.query('COMMIT')
    } catch (error) {
      await setupClient.query('ROLLBACK')
      throw error
    } finally {
      setupClient.release()
    }

    while (true) {
      const batchClient = await database.connect()
      try {
        await batchClient.query('BEGIN')
        const batch = await rebuildIndexBatch(batchClient, lastRevisionId)
        if (batch.processed === 0) {
          await batchClient.query('ROLLBACK')
          break
        }
        lastRevisionId = batch.lastRevisionId
        await batchClient.query(
          `UPDATE applicability_reindex_runs
           SET revisions_indexed = revisions_indexed + $2,
               last_revision_id = $3
           WHERE id = $1`,
          [runId, batch.processed, lastRevisionId],
        )
        await batchClient.query('COMMIT')
      } catch (error) {
        await batchClient.query('ROLLBACK')
        throw error
      } finally {
        batchClient.release()
      }
    }

    const finalClient = await database.connect()
    try {
      await finalClient.query('BEGIN')
      const indexed = await finalClient.query<{ count: number }>(
        `SELECT count(*)::int AS count
         FROM knowledge_applicability_index applicability
         JOIN knowledge_revisions revision
           ON revision.id = applicability.revision_id
         WHERE revision.domain_id = 'network'`,
      )
      const breakdown = await finalClient.query<{
        family: string
        scope: string
        records: number
      }>(
        `SELECT
           family.slug AS family,
           applicability.scope_level AS scope,
           count(*)::int AS records
         FROM knowledge_applicability_index applicability
         JOIN software_families family
           ON family.id = applicability.family_id
         JOIN knowledge_revisions revision
           ON revision.id = applicability.revision_id
         WHERE revision.domain_id = 'network'
         GROUP BY family.slug, applicability.scope_level
         ORDER BY family.slug, applicability.scope_level`,
      )
      const manifest = JSON.stringify(breakdown.rows)
      const manifestHash = `sha256:${createHash('sha256')
        .update(manifest)
        .digest('hex')}`
      const portable = breakdown.rows
        .filter((row) => [
          'onie', 'sonic', 'openwrt', 'debian', 'linux-userspace',
          'linux-iproute2', 'linux-netfilter', 'cumulus-linux'
        ].includes(row.family))
        .reduce((sum, row) => sum + Number(row.records), 0)
      if (
        verify && Number(indexed.rows[0]?.count ?? 0) !== expectedCount
      ) {
        throw new Error('APPLICABILITY_REINDEX_CONSERVATION_FAILED')
      }
      await finalClient.query(
        `UPDATE applicability_reindex_runs
         SET status = 'completed',
             revisions_indexed = $2,
             portable_revisions = $3,
             manifest_hash = $4,
             breakdown = $5::jsonb,
             completed_at = now(),
             last_error = NULL
         WHERE id = $1`,
        [
          runId,
          indexed.rows[0]?.count ?? 0,
          portable,
          manifestHash,
          manifest
        ],
      )
      await finalClient.query('ANALYZE knowledge_applicability_index')
      await finalClient.query('COMMIT')
      logger.info({
        run_id: runId,
        revisions_expected: expectedCount,
        revisions_indexed: indexed.rows[0]?.count ?? 0,
        portable_revisions: portable,
        manifest_hash: manifestHash,
        breakdown: breakdown.rows
      }, 'Applicability reindex complete')
    } catch (error) {
      await finalClient.query('ROLLBACK')
      throw error
    } finally {
      finalClient.release()
    }
  }
} catch (error) {
  if (runId) {
    await database.query(
      `UPDATE applicability_reindex_runs
       SET status = 'failed',
           last_error = $2,
           completed_at = now()
       WHERE id = $1`,
      [runId, error instanceof Error ? error.message.slice(0, 1_000) : 'unknown'],
    ).catch(() => undefined)
  }
  logger.fatal({ err: error }, 'Applicability reindex failed')
  process.exitCode = 1
} finally {
  await database.end()
}
