import { sha256Label } from '../crypto.js'
import { withTransaction } from '../db.js'
import { CISCO_INTERFACE_BRIEF_PATTERNS } from '../seed-data/cisco.js'
import { normalizeVendorVersion } from '../version.js'
import { createCliRuntime } from './runtime.js'

const { database, logger } = createCliRuntime()

try {
  const result = await withTransaction(database, async (client) => {
    const vendor = await client.query<{ id: string }>(
      `INSERT INTO vendors (slug, display_name)
       VALUES ('cisco', 'Cisco')
       ON CONFLICT (slug)
       DO UPDATE SET display_name = excluded.display_name
       RETURNING id`,
    )
    const vendorId = vendor.rows[0]!.id

    const platform = await client.query<{ id: string }>(
      `INSERT INTO platforms (
         vendor_id, slug, display_name, model_pattern
       )
       VALUES ($1, 'catalyst-9000', 'Catalyst 9000', '^(c9[0-9]{3}|catalyst[ -]?9)')
       ON CONFLICT (vendor_id, slug)
       DO UPDATE SET
         display_name = excluded.display_name,
         model_pattern = excluded.model_pattern
       RETURNING id`,
      [vendorId],
    )
    const platformId = platform.rows[0]!.id

    const operatingSystem = await client.query<{ id: string }>(
      `INSERT INTO operating_systems (
         vendor_id, slug, display_name, version_scheme
       )
       VALUES ($1, 'ios-xe', 'Cisco IOS XE', 'vendor')
       ON CONFLICT (vendor_id, slug)
       DO UPDATE SET display_name = excluded.display_name
       RETURNING id`,
      [vendorId],
    )
    const operatingSystemId = operatingSystem.rows[0]!.id

    await client.query(
      `INSERT INTO context_aliases (vendor_id, alias)
       SELECT $1, alias
       FROM unnest(ARRAY['cisco systems', 'cisco ios']) AS alias
       WHERE NOT EXISTS (
         SELECT 1 FROM context_aliases existing
         WHERE existing.vendor_id = $1 AND existing.alias = alias
       )`,
      [vendorId],
    )
    await client.query(
      `INSERT INTO context_aliases (platform_id, alias)
       SELECT $1, alias
       FROM unnest(ARRAY['c9300', 'c9200', 'c9400', 'cat9k', 'catalyst 9300']) AS alias
       WHERE NOT EXISTS (
         SELECT 1 FROM context_aliases existing
         WHERE existing.platform_id = $1 AND existing.alias = alias
       )`,
      [platformId],
    )
    await client.query(
      `INSERT INTO context_aliases (operating_system_id, alias)
       SELECT $1, alias
       FROM unnest(ARRAY['iosxe', 'ios xe', 'cisco ios-xe']) AS alias
       WHERE NOT EXISTS (
         SELECT 1 FROM context_aliases existing
         WHERE existing.operating_system_id = $1 AND existing.alias = alias
       )`,
      [operatingSystemId],
    )

    const existing = await client.query<{ id: string }>(
      `SELECT kr.id
       FROM knowledge_items ki
       JOIN knowledge_revisions kr ON kr.knowledge_item_id = ki.id
       WHERE ki.stable_key = 'cisco.ios-xe.show-ip-interface-brief'
       ORDER BY kr.revision_number DESC
       LIMIT 1`,
    )
    if (existing.rows[0]) {
      return { seeded: false, revisionId: existing.rows[0].id }
    }

    const item = await client.query<{ id: string }>(
      `INSERT INTO knowledge_items (stable_key, kind)
       VALUES ('cisco.ios-xe.show-ip-interface-brief', 'command')
       RETURNING id`,
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
         version_normalized_min,
         title,
         summary,
         question_patterns,
         cli_mode,
         command_text,
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
         $1, 1, 'validated', $2, $3, $4, '16.6', $5,
         'Display a concise Layer 3 interface status summary',
         'Use the operational show command to list interfaces, assigned IP addresses, administrative state, and line protocol state.',
         $6,
         'privileged EXEC',
         'show ip interface brief',
         '["Obtain read-only CLI access to the target device.","Confirm the prompt is in EXEC or privileged EXEC mode."]'::jsonb,
         '["Operational show command only; output may reveal addressing and interface names, so handle it as infrastructure data."]'::jsonb,
         '["Confirm each expected interface appears.","Compare Status and Protocol columns; investigate any unexpected administratively down or down state."]'::jsonb,
         '["No configuration change is made; rollback is not applicable."]'::jsonb,
         '["The summary does not replace detailed counters, optics, logs, or configuration inspection."]'::jsonb,
         false,
         0.990,
         0.970,
         'Verified against current vendor command reference and constrained to IOS XE operational mode.',
         DATE '2026-07-17',
         'seed'
       )
       RETURNING id`,
      [
        itemId,
        vendorId,
        platformId,
        operatingSystemId,
        normalizeVendorVersion('16.6'),
        [...CISCO_INTERFACE_BRIEF_PATTERNS]
      ],
    )
    const revisionId = revision.rows[0]!.id

    const sourceUrl =
      'https://www.cisco.com/c/en/us/td/docs/ios-xml/ios/interface/command/ir-cr-book.html'
    const sourceTitle = 'Cisco IOS Interface and Hardware Component Command Reference'
    const evidence =
      'The command returns a compact table containing interface, address, method, status, and protocol fields.'
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
       VALUES ($1, 'vendor_command_reference', $2, $3, 'IOS XE', DATE '2026-07-17', $4, $5)
       ON CONFLICT (canonical_url, content_hash)
       DO UPDATE SET verified_at = excluded.verified_at
       RETURNING id`,
      [
        sourceUrl,
        sourceTitle,
        vendorId,
        sha256Label(`${sourceUrl}\n${sourceTitle}\n${evidence}`),
        evidence
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
        'Primary vendor command reference; fact was independently structured and scoped.'
      ],
    )

    const release = await client.query<{ id: string }>(
      `INSERT INTO releases (status, reason, created_by)
       VALUES ('published', 'Initial verified Cisco IOS XE vertical scenario', 'seed')
       RETURNING id`,
    )
    const releaseId = release.rows[0]!.id
    await client.query(
      `INSERT INTO release_items (release_id, knowledge_item_id, revision_id)
       VALUES ($1, $2, $3)`,
      [releaseId, itemId, revisionId],
    )
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
    return { seeded: true, revisionId }
  })

  logger.info(result, 'Seed complete')
} catch (error) {
  logger.fatal({ err: error }, 'Seed failed')
  process.exitCode = 1
} finally {
  await database.end()
}
