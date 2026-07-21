import type { DatabaseClient } from '../db.js'
import {
  createKnowledgeRevision,
  publishKnowledgeBatch,
  type CandidateKnowledge
} from '../domain/publication.js'
import { classifyKnowledgeRisk } from '../domain/risk.js'
import { createCliRuntime } from './runtime.js'

type RepairRow = {
  revision_id: string
  stable_key: string
  kind: CandidateKnowledge['kind']
  vendor_slug: string
  platform_slug: string | null
  operating_system_slug: string
  version_min: string | null
  version_max: string | null
  software_family_slug: string
  scope_level: CandidateKnowledge['applicability_scope']
  architecture_slug: string | null
  version_scope: CandidateKnowledge['version_scope']
  version_branch: string | null
  title: string
  summary: string
  question_patterns: string[]
  cli_mode: string | null
  command_text: string | null
  procedure_steps: string[]
  prerequisites: string[]
  risks: string[]
  verification_steps: string[]
  rollback_steps: string[]
  limitations: string[]
  confidence: string
  quality_score: string
  confidence_reason: string
  last_verified_at: string | Date
}

type ProvenanceRow = {
  canonical_url: string
  document_type: string
  title: string
  document_version: string | null
  document_date: string | Date | null
  verified_at: string | Date
  content_hash: string
  evidence_fragment: string
  evidence_role: 'primary' | 'corroborating' | 'conflict'
}

const portableFamilies = [
  'onie',
  'sonic',
  'openwrt',
  'debian',
  'linux-userspace',
  'linux-iproute2',
  'linux-netfilter',
  'cumulus-linux'
]

function dateOnly(value: string | Date): string {
  return new Date(value).toISOString().slice(0, 10)
}

function cleanLegacyRiskLines(lines: string[]): string[] {
  return lines.filter((line) =>
    !/^Legacy risk classification:/i.test(line) &&
    !/^Deterministic safety classifier enforced risk level/i.test(line) &&
    !/^CliDeck deterministic guard enforced risk level/i.test(line)
  )
}

function skippableLegacyCandidateReason(error: unknown): string | null {
  if (!(error instanceof Error)) return null
  const prefix = 'NETWORK_DOMAIN_CANDIDATE_INVALID:'
  if (!error.message.startsWith(prefix)) return null
  const reason = error.message.slice(prefix.length).trim()
  return reason || 'NETWORK_DOMAIN_CANDIDATE_INVALID'
}

async function loadRepairableRows(
  client: DatabaseClient,
): Promise<RepairRow[]> {
  const result = await client.query<RepairRow>(
    `SELECT
       revision.id AS revision_id,
       item.stable_key,
       item.kind,
       vendor.slug AS vendor_slug,
       platform.slug AS platform_slug,
       os.slug AS operating_system_slug,
       revision.version_min,
       revision.version_max,
       family.slug AS software_family_slug,
       applicability.scope_level,
       applicability.architecture_slug,
       applicability.version_scope,
       applicability.version_branch,
       revision.title,
       revision.summary,
       revision.question_patterns,
       revision.cli_mode,
       revision.command_text,
       revision.procedure_steps,
       revision.prerequisites,
       revision.risks,
       revision.verification_steps,
       revision.rollback_steps,
       revision.limitations,
       revision.confidence,
       revision.quality_score,
       revision.confidence_reason,
       revision.last_verified_at
     FROM active_knowledge_state active
     JOIN knowledge_revisions revision ON revision.id = active.revision_id
     JOIN knowledge_items item ON item.id = active.knowledge_item_id
     JOIN vendors vendor ON vendor.id = revision.vendor_id
     LEFT JOIN platforms platform ON platform.id = revision.platform_id
     JOIN operating_systems os ON os.id = revision.operating_system_id
     JOIN knowledge_applicability_index applicability
       ON applicability.revision_id = revision.id
     JOIN software_families family ON family.id = applicability.family_id
     WHERE item.domain_id = 'network'
       AND revision.domain_id = 'network'
       AND revision.dangerous
       AND revision.confidence >= 0.9
       AND family.slug = ANY($1::text[])
     ORDER BY revision.id`,
    [portableFamilies],
  )
  return result.rows.filter((row) =>
    classifyKnowledgeRisk([
      ...(row.command_text ? [row.command_text] : []),
      ...row.procedure_steps
    ]) === 'safe_read_only'
  )
}

async function loadProvenance(
  client: DatabaseClient,
  revisionId: string,
): Promise<ProvenanceRow[]> {
  const result = await client.query<ProvenanceRow>(
    `SELECT
       source.canonical_url,
       source.document_type,
       source.title,
       source.document_version,
       source.document_date,
       source.verified_at,
       source.content_hash,
       source.evidence_fragment,
       revision_source.evidence_role
     FROM revision_sources revision_source
     JOIN source_documents source
       ON source.id = revision_source.source_document_id
     WHERE revision_source.revision_id = $1
       AND source.canonical_url LIKE 'https://%'
     ORDER BY CASE revision_source.evidence_role
       WHEN 'primary' THEN 0 WHEN 'corroborating' THEN 1 ELSE 2 END,
       source.id
     LIMIT 10`,
    [revisionId],
  )
  return result.rows
}

const { database, logger } = createCliRuntime()
try {
  const client = await database.connect()
  try {
    await client.query('BEGIN')
    const rows = await loadRepairableRows(client)
    const revisions: { itemId: string; revisionId: string }[] = []
    let skippedWithoutEvidence = 0
    const skippedInvalid: Record<string, number> = {}
    for (const row of rows) {
      const provenance = await loadProvenance(client, row.revision_id)
      if (provenance.length === 0) {
        skippedWithoutEvidence += 1
        continue
      }
      await client.query('SAVEPOINT portable_risk_record')
      try {
        revisions.push(await createKnowledgeRevision(client, {
          stable_key: row.stable_key,
          kind: row.kind,
          vendor_slug: row.vendor_slug,
          platform_slug: row.platform_slug ?? undefined,
          operating_system_slug: row.operating_system_slug,
          version_min: row.version_min ?? undefined,
          version_max: row.version_max ?? undefined,
          software_family_slug: row.software_family_slug,
          applicability_scope: row.scope_level,
          architecture_slug: row.architecture_slug ?? undefined,
          version_scope: row.version_scope,
          version_branch: row.version_branch ?? undefined,
          title: row.title,
          summary: row.summary,
          question_patterns: row.question_patterns,
          cli_mode: row.cli_mode ?? undefined,
          command: row.command_text ?? undefined,
          procedure: row.procedure_steps,
          prerequisites: row.prerequisites,
          risks: cleanLegacyRiskLines(row.risks),
          verification: row.verification_steps,
          rollback: row.rollback_steps,
          limitations: [
            ...row.limitations,
            'Safety metadata was deterministically reclassified without changing the documented operation.'
          ],
          dangerous: false,
          risk_level: 'safe_read_only',
          confidence: Number(row.confidence),
          quality_score: Number(row.quality_score),
          confidence_reason: row.confidence_reason,
          last_verified_at: dateOnly(row.last_verified_at),
          provenance: provenance.map((source) => ({
            url: source.canonical_url,
            document_type: source.document_type.slice(0, 80),
            title: source.title.slice(0, 240),
            document_version: source.document_version ?? undefined,
            document_date: source.document_date
              ? dateOnly(source.document_date)
              : undefined,
            verified_at: dateOnly(source.verified_at),
            content_hash: source.content_hash,
            evidence_fragment: source.evidence_fragment,
            evidence_role: source.evidence_role
          }))
        }, 'super_admin'))
        await client.query('RELEASE SAVEPOINT portable_risk_record')
      } catch (error) {
        await client.query('ROLLBACK TO SAVEPOINT portable_risk_record')
        await client.query('RELEASE SAVEPOINT portable_risk_record')
        const reason = skippableLegacyCandidateReason(error)
        if (!reason) throw error
        skippedInvalid[reason] = (skippedInvalid[reason] ?? 0) + 1
      }
    }
    const release = revisions.length > 0
      ? await publishKnowledgeBatch(
          client,
          revisions,
          'Correct deterministic risk metadata for portable inspection commands.',
          'clideck-mcp-applicability-repair',
        )
      : null
    await client.query('COMMIT')
    logger.info({
      inspected: rows.length,
      corrected: revisions.length,
      skipped_without_evidence: skippedWithoutEvidence,
      skipped_invalid: skippedInvalid,
      release_sequence: release?.sequence ?? null
    }, 'Portable risk metadata reconciliation complete')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
} catch (error) {
  logger.fatal({ err: error }, 'Portable risk metadata reconciliation failed')
  process.exitCode = 1
} finally {
  await database.end()
}
