import type { Database } from '../db.js'

type PublicSourceKind =
  | 'official_web'
  | 'admin_web'
  | 'admin_document'
  | 'pasted_text'
  | 'field_log'

type ProvenanceRow = {
  revision_ref: string
  source_ref: string | null
  source_kind: PublicSourceKind | null
  title: string
  canonical_url: string
  document_version: string | null
  document_date: string | Date | null
  verified_at: string | Date
}

function isoDate(value: string | Date | null): string | null {
  if (value === null) return null
  return new Date(value).toISOString().slice(0, 10)
}

function safeSourceUrl(
  publicBaseUrl: string,
  sourceKind: PublicSourceKind,
  sourceRef: string | null,
  canonicalUrl: string,
): string {
  if (
    sourceRef &&
    ['admin_document', 'pasted_text', 'field_log'].includes(sourceKind)
  ) {
    return new URL(`/sources/${sourceRef}`, publicBaseUrl).toString()
  }
  const url = new URL(canonicalUrl)
  if (url.protocol !== 'https:') throw new Error('PROVENANCE_URL_INVALID')
  return url.toString()
}

export async function getPublicKnowledgeProvenance(
  database: Database,
  publicBaseUrl: string,
  revisionRefs: readonly string[],
) {
  const result = await database.query<ProvenanceRow>(
    `SELECT
       revision.public_ref::text AS revision_ref,
       source.source_ref,
       source.source_kind,
       source.title,
       source.canonical_url,
       source.document_version,
       source.document_date,
       source.verified_at
     FROM active_knowledge_state active
     JOIN knowledge_revisions revision ON revision.id = active.revision_id
     JOIN revision_sources link ON link.revision_id = revision.id
     JOIN source_documents source ON source.id = link.source_document_id
     WHERE revision.public_ref = ANY($1::uuid[])
     ORDER BY
       array_position($1::uuid[], revision.public_ref),
       CASE link.evidence_role
         WHEN 'primary' THEN 1
         WHEN 'corroborating' THEN 2
         ELSE 3
       END,
       source.verified_at DESC`,
    [[...new Set(revisionRefs)]],
  )

  const revisions = new Map<string, Array<{
    source_ref: string | null
    source_kind: PublicSourceKind
    title: string
    url: string
    document_version: string | null
    document_date: string | null
    verified_at: string
  }>>()
  for (const row of result.rows) {
    const sourceKind = row.source_kind ?? 'official_web'
    const sources = revisions.get(row.revision_ref) ?? []
    sources.push({
      source_ref: row.source_ref,
      source_kind: sourceKind,
      title: row.title,
      url: safeSourceUrl(
        publicBaseUrl,
        sourceKind,
        row.source_ref,
        row.canonical_url,
      ),
      document_version: row.document_version,
      document_date: isoDate(row.document_date),
      verified_at: isoDate(row.verified_at)!,
    })
    revisions.set(row.revision_ref, sources)
  }

  return {
    revisions: revisionRefs.flatMap((revisionRef) => {
      const sources = revisions.get(revisionRef)
      return sources ? [{ revision_ref: revisionRef, sources }] : []
    })
  }
}
