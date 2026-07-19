import { sha256Label } from '../crypto.js'
import type { DatabaseClient } from '../db.js'
import { withTransaction } from '../db.js'
import {
  IOS_XE_SEED_KNOWLEDGE,
  type SeedKnowledge
} from '../seed-data/ios-xe-knowledge.js'
import { normalizeVendorVersion } from '../version.js'
import { createCliRuntime } from './runtime.js'

const { database, logger } = createCliRuntime()

type SeedContext = {
  ciscoVendorId: string
  catalystPlatformId: string
  iosXeId: string
}

async function upsertCatalog(client: DatabaseClient): Promise<SeedContext> {
  const cisco = await client.query<{ id: string }>(
    `INSERT INTO vendors (slug, display_name)
     VALUES ('cisco', 'Cisco')
     ON CONFLICT (slug)
     DO UPDATE SET display_name = excluded.display_name
     RETURNING id`,
  )
  const juniper = await client.query<{ id: string }>(
    `INSERT INTO vendors (slug, display_name)
     VALUES ('juniper', 'Juniper')
     ON CONFLICT (slug)
     DO UPDATE SET display_name = excluded.display_name
     RETURNING id`,
  )
  const arista = await client.query<{ id: string }>(
    `INSERT INTO vendors (slug, display_name)
     VALUES ('arista', 'Arista')
     ON CONFLICT (slug)
     DO UPDATE SET display_name = excluded.display_name
     RETURNING id`,
  )

  const catalyst = await client.query<{ id: string }>(
    `INSERT INTO platforms (
       vendor_id, slug, display_name, model_pattern
     )
     VALUES (
       $1,
       'catalyst-9000',
       'Catalyst 9000',
       '^(c9[0-9]{3}|catalyst[ -]?9)'
     )
     ON CONFLICT (vendor_id, slug)
     DO UPDATE SET
       display_name = excluded.display_name,
       model_pattern = excluded.model_pattern
     RETURNING id`,
    [cisco.rows[0]!.id],
  )
  const junosPlatform = await client.query<{ id: string }>(
    `INSERT INTO platforms (
       vendor_id, slug, display_name, model_pattern
     )
     VALUES ($1, 'junos-networking', 'Junos Networking', '^(ex|qfx|mx|srx)')
     ON CONFLICT (vendor_id, slug)
     DO UPDATE SET
       display_name = excluded.display_name,
       model_pattern = excluded.model_pattern
     RETURNING id`,
    [juniper.rows[0]!.id],
  )
  const eosPlatform = await client.query<{ id: string }>(
    `INSERT INTO platforms (
       vendor_id, slug, display_name, model_pattern
     )
     VALUES ($1, 'eos-switching', 'Arista EOS Switching', '^(dcs-|ccs-|7[0-9]{3})')
     ON CONFLICT (vendor_id, slug)
     DO UPDATE SET
       display_name = excluded.display_name,
       model_pattern = excluded.model_pattern
     RETURNING id`,
    [arista.rows[0]!.id],
  )

  const iosXe = await client.query<{ id: string }>(
    `INSERT INTO operating_systems (
       vendor_id, slug, display_name, version_scheme
     )
     VALUES ($1, 'ios-xe', 'Cisco IOS XE', 'vendor')
     ON CONFLICT (vendor_id, slug)
     DO UPDATE SET display_name = excluded.display_name
     RETURNING id`,
    [cisco.rows[0]!.id],
  )
  const junos = await client.query<{ id: string }>(
    `INSERT INTO operating_systems (
       vendor_id, slug, display_name, version_scheme
     )
     VALUES ($1, 'junos', 'Junos', 'vendor')
     ON CONFLICT (vendor_id, slug)
     DO UPDATE SET display_name = excluded.display_name
     RETURNING id`,
    [juniper.rows[0]!.id],
  )
  const eos = await client.query<{ id: string }>(
    `INSERT INTO operating_systems (
       vendor_id, slug, display_name, version_scheme
     )
     VALUES ($1, 'eos', 'Arista EOS', 'vendor')
     ON CONFLICT (vendor_id, slug)
     DO UPDATE SET display_name = excluded.display_name
     RETURNING id`,
    [arista.rows[0]!.id],
  )

  const aliases: Array<{
    column: 'vendor_id' | 'platform_id' | 'operating_system_id'
    id: string
    values: string[]
  }> = [
    {
      column: 'vendor_id',
      id: cisco.rows[0]!.id,
      values: ['cisco systems', 'cisco ios']
    },
    {
      column: 'platform_id',
      id: catalyst.rows[0]!.id,
      values: ['c9300', 'c9300l', 'c9300x', 'c9300lm', 'cat9k', 'catalyst 9300']
    },
    {
      column: 'operating_system_id',
      id: iosXe.rows[0]!.id,
      values: ['iosxe', 'ios xe', 'cisco ios-xe']
    },
    {
      column: 'vendor_id',
      id: juniper.rows[0]!.id,
      values: ['juniper networks']
    },
    {
      column: 'platform_id',
      id: junosPlatform.rows[0]!.id,
      values: ['juniper ex', 'juniper qfx', 'juniper mx', 'juniper srx']
    },
    {
      column: 'operating_system_id',
      id: junos.rows[0]!.id,
      values: ['juniper junos', 'junos os']
    },
    {
      column: 'vendor_id',
      id: arista.rows[0]!.id,
      values: ['arista networks']
    },
    {
      column: 'platform_id',
      id: eosPlatform.rows[0]!.id,
      values: ['arista dcs', 'arista switch']
    },
    {
      column: 'operating_system_id',
      id: eos.rows[0]!.id,
      values: ['arista eos', 'eos']
    }
  ]
  for (const alias of aliases) {
    await client.query(
      `INSERT INTO context_aliases (${alias.column}, alias)
       SELECT $1, value
       FROM unnest($2::text[]) AS value
       WHERE NOT EXISTS (
         SELECT 1
         FROM context_aliases existing
         WHERE existing.${alias.column} = $1
           AND existing.alias = value
       )`,
      [alias.id, alias.values],
    )
  }

  const models: Array<{
    platformId: string
    slug: string
    name: string
    pattern: string
    support: 'recognized' | 'deep'
  }> = [
    { platformId: catalyst.rows[0]!.id, slug: 'c9200', name: 'Catalyst 9200', pattern: '^C9200(?:L|CX)?(?:-|$)', support: 'recognized' },
    { platformId: catalyst.rows[0]!.id, slug: 'c9300', name: 'Catalyst 9300', pattern: '^C9300(?:-|$)', support: 'deep' },
    { platformId: catalyst.rows[0]!.id, slug: 'c9300l', name: 'Catalyst 9300L', pattern: '^C9300L(?:-|$)', support: 'deep' },
    { platformId: catalyst.rows[0]!.id, slug: 'c9300x', name: 'Catalyst 9300X', pattern: '^C9300X(?:-|$)', support: 'deep' },
    { platformId: catalyst.rows[0]!.id, slug: 'c9300lm', name: 'Catalyst 9300LM', pattern: '^C9300LM(?:-|$)', support: 'deep' },
    { platformId: catalyst.rows[0]!.id, slug: 'c9400', name: 'Catalyst 9400', pattern: '^C9400(?:-|$)', support: 'recognized' },
    { platformId: catalyst.rows[0]!.id, slug: 'c9500', name: 'Catalyst 9500', pattern: '^C9500X?(?:-|$)', support: 'recognized' },
    { platformId: catalyst.rows[0]!.id, slug: 'c9600', name: 'Catalyst 9600', pattern: '^C9600X?(?:-|$)', support: 'recognized' },
    { platformId: junosPlatform.rows[0]!.id, slug: 'junos-ex', name: 'Juniper EX', pattern: '^EX[0-9A-Z-]+$', support: 'recognized' },
    { platformId: junosPlatform.rows[0]!.id, slug: 'junos-qfx', name: 'Juniper QFX', pattern: '^QFX[0-9A-Z-]+$', support: 'recognized' },
    { platformId: junosPlatform.rows[0]!.id, slug: 'junos-mx', name: 'Juniper MX', pattern: '^MX[0-9A-Z-]+$', support: 'recognized' },
    { platformId: junosPlatform.rows[0]!.id, slug: 'junos-srx', name: 'Juniper SRX', pattern: '^SRX[0-9A-Z-]+$', support: 'recognized' },
    { platformId: eosPlatform.rows[0]!.id, slug: 'arista-7050', name: 'Arista 7050', pattern: '^(?:DCS-)?7050[A-Z0-9-]*$', support: 'recognized' },
    { platformId: eosPlatform.rows[0]!.id, slug: 'arista-7280', name: 'Arista 7280', pattern: '^(?:DCS-)?7280[A-Z0-9-]*$', support: 'recognized' }
  ]
  for (const model of models) {
    await client.query(
      `INSERT INTO device_models (
         platform_id, slug, display_name, model_pattern, support_level
       )
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (platform_id, slug)
       DO UPDATE SET
         display_name = excluded.display_name,
         model_pattern = excluded.model_pattern,
         support_level = excluded.support_level`,
      [
        model.platformId,
        model.slug,
        model.name,
        model.pattern,
        model.support
      ],
    )
  }

  return {
    ciscoVendorId: cisco.rows[0]!.id,
    catalystPlatformId: catalyst.rows[0]!.id,
    iosXeId: iosXe.rows[0]!.id
  }
}

async function seedKnowledgeItem(
  client: DatabaseClient,
  context: SeedContext,
  fact: SeedKnowledge,
): Promise<{ itemId: string; revisionId: string; created: boolean }> {
  const existing = await client.query<{ item_id: string; revision_id: string }>(
    `SELECT
       ki.id AS item_id,
       kr.id AS revision_id
     FROM knowledge_items ki
     JOIN knowledge_revisions kr ON kr.knowledge_item_id = ki.id
     WHERE ki.stable_key = $1
     ORDER BY kr.revision_number DESC
     LIMIT 1`,
    [fact.stableKey],
  )
  if (existing.rows[0]) {
    await client.query(
      `INSERT INTO knowledge_public_trust (
         revision_id,
         validation_level,
         independent_confirmations,
         confidence_explanation,
         next_review_at
       )
       VALUES (
         $1,
         'documentation_reviewed',
         1,
         'Verified against a vendor-maintained command or release reference with bounded IOS-XE applicability.',
         DATE '2027-01-17'
       )
       ON CONFLICT (revision_id) DO NOTHING`,
      [existing.rows[0].revision_id],
    )
    if (fact.contract) {
      await client.query(
        `INSERT INTO knowledge_revision_contracts (
           revision_id, contract_type, payload
         )
         VALUES ($1, $2, $3::jsonb)
         ON CONFLICT (revision_id, contract_type) DO NOTHING`,
        [
          existing.rows[0].revision_id,
          fact.contract.type,
          JSON.stringify(fact.contract.payload)
        ],
      )
    }
    return {
      itemId: existing.rows[0].item_id,
      revisionId: existing.rows[0].revision_id,
      created: false
    }
  }

  const item = await client.query<{ id: string }>(
    `INSERT INTO knowledge_items (stable_key, kind)
     VALUES ($1, $2)
     RETURNING id`,
    [fact.stableKey, fact.kind],
  )
  const itemId = item.rows[0]!.id
  const revision = await client.query<{ id: string }>(
    `INSERT INTO knowledge_revisions (
       knowledge_item_id,
       revision_number,
       status,
       vendor_id,
       platform_id,
       operating_system_id,
       version_min,
       version_max,
       version_normalized_min,
       version_normalized_max,
       title,
       summary,
       question_patterns,
       cli_mode,
       command_text,
       procedure_steps,
       prerequisites,
       risks,
       verification_steps,
       rollback_steps,
       limitations,
       dangerous,
       confidence,
       quality_score,
       confidence_reason,
       last_verified_at,
       created_by
     )
     VALUES (
       $1, 1, 'validated', $2, $3, $4, $5, $6, $7, $8,
       $9, $10, $11, $12, $13, $14::jsonb, $15::jsonb, $16::jsonb,
       $17::jsonb, $18::jsonb, $19::jsonb, $20, $21, $22, $23,
       DATE '2026-07-17', 'seed'
     )
     RETURNING id`,
    [
      itemId,
      context.ciscoVendorId,
      context.catalystPlatformId,
      context.iosXeId,
      fact.versionMin,
      fact.versionMax ?? null,
      normalizeVendorVersion(fact.versionMin),
      fact.versionMax ? normalizeVendorVersion(fact.versionMax) : null,
      fact.title,
      fact.summary,
      fact.questionPatterns,
      fact.cliMode ?? null,
      fact.command ?? null,
      JSON.stringify(fact.procedure),
      JSON.stringify(fact.prerequisites),
      JSON.stringify(fact.risks),
      JSON.stringify(fact.verification),
      JSON.stringify(fact.rollback),
      JSON.stringify(fact.limitations),
      fact.dangerous,
      fact.confidence,
      fact.qualityScore,
      'Verified against a vendor-maintained command or release reference with bounded IOS-XE applicability.'
    ],
  )
  const revisionId = revision.rows[0]!.id

  const contentHash = sha256Label(
    `${fact.source.url}\n${fact.source.title}\n${fact.evidence}`,
  )
  const source = await client.query<{ id: string }>(
    `INSERT INTO source_documents (
       canonical_url,
       document_type,
       title,
       vendor_id,
       document_version,
       verified_at,
       content_hash,
       evidence_fragment
     )
     VALUES (
       $1, $2, $3, $4, 'IOS XE', DATE '2026-07-17', $5, $6
     )
     ON CONFLICT (domain_id, canonical_url, content_hash)
     DO UPDATE SET verified_at = excluded.verified_at
     RETURNING id`,
    [
      fact.source.url,
      fact.source.documentType,
      fact.source.title,
      context.ciscoVendorId,
      contentHash,
      fact.evidence
    ],
  )
  await client.query(
    `INSERT INTO revision_sources (
       revision_id, source_document_id, evidence_role, confidence_reason
     )
     VALUES ($1, $2, 'primary', $3)`,
    [
      revisionId,
      source.rows[0]!.id,
      'Primary vendor-maintained reference; the public fact is independently structured and version-scoped.'
    ],
  )
  await client.query(
    `INSERT INTO knowledge_public_trust (
       revision_id,
       validation_level,
       independent_confirmations,
       confidence_explanation,
       next_review_at
     )
     VALUES (
       $1,
       'documentation_reviewed',
       1,
       'Verified against a vendor-maintained command or release reference with bounded IOS-XE applicability.',
       $2
     )`,
    [
      revisionId,
      fact.dangerous ? '2026-10-15' : '2027-01-17'
    ],
  )
  if (fact.contract) {
    await client.query(
      `INSERT INTO knowledge_revision_contracts (
         revision_id, contract_type, payload
       )
       VALUES ($1, $2, $3::jsonb)`,
      [revisionId, fact.contract.type, JSON.stringify(fact.contract.payload)],
    )
  }

  return { itemId, revisionId, created: true }
}

try {
  const result = await withTransaction(database, async (client) => {
    const context = await upsertCatalog(client)
    const activeSeedCount = await client.query<{ count: number }>(
      `SELECT count(*)::int AS count
       FROM public_active_knowledge
       WHERE stable_key = ANY($1::text[])`,
      [IOS_XE_SEED_KNOWLEDGE.map((fact) => fact.stableKey)],
    )
    if (activeSeedCount.rows[0]?.count === IOS_XE_SEED_KNOWLEDGE.length) {
      return {
        seeded: false,
        knowledgeItems: IOS_XE_SEED_KNOWLEDGE.length
      }
    }

    const seeded = []
    for (const fact of IOS_XE_SEED_KNOWLEDGE) {
      seeded.push(await seedKnowledgeItem(client, context, fact))
    }

    const current = await client.query<{ release_id: string }>(
      'SELECT release_id FROM active_release WHERE singleton FOR UPDATE',
    )
    const release = await client.query<{ id: string; sequence: number }>(
      `INSERT INTO releases (status, reason, created_by)
       VALUES (
         'published',
         'CliDeck MCP 0.2 verified IOS-XE product knowledge pack',
         'seed'
       )
       RETURNING id, sequence`,
    )
    const releaseId = release.rows[0]!.id
    const seededItemIds = seeded.map((entry) => entry.itemId)
    if (current.rows[0]) {
      await client.query(
        `INSERT INTO release_items (
           release_id, knowledge_item_id, revision_id
         )
         SELECT $1, knowledge_item_id, revision_id
         FROM release_items
         WHERE release_id = $2
           AND NOT (knowledge_item_id = ANY($3::uuid[]))`,
        [releaseId, current.rows[0].release_id, seededItemIds],
      )
    }
    for (const entry of seeded) {
      await client.query(
        `INSERT INTO release_items (
           release_id, knowledge_item_id, revision_id
         )
         VALUES ($1, $2, $3)`,
        [releaseId, entry.itemId, entry.revisionId],
      )
    }
    if (current.rows[0]) {
      await client.query(
        `UPDATE releases
         SET status = 'superseded'
         WHERE id = $1 AND status = 'published'`,
        [current.rows[0].release_id],
      )
    }
    await client.query(
      `INSERT INTO active_release (singleton, release_id, switched_by)
       VALUES (true, $1, 'seed')
       ON CONFLICT (singleton)
       DO UPDATE SET
         release_id = excluded.release_id,
         switched_at = now(),
         switched_by = excluded.switched_by`,
      [releaseId],
    )

    return {
      seeded: true,
      knowledgeItems: seeded.length,
      createdRevisions: seeded.filter((entry) => entry.created).length,
      releaseSequence: release.rows[0]!.sequence
    }
  })
  logger.info(result, 'Seed complete')
} catch (error) {
  logger.fatal({ err: error }, 'Seed failed')
  process.exitCode = 1
} finally {
  await database.end()
}
