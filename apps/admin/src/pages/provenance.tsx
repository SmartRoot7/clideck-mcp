import {
  FileLock2,
  Fingerprint,
  History,
  Search
} from 'lucide-react'
import { useState } from 'react'

import {
  Button,
  EmptyState,
  ErrorState,
  KeyValue,
  LoadingState,
  Panel,
  Status
} from '../components/ui'
import { formatDate, shortId, titleCase } from '../lib/format'
import { useProvenance } from '../lib/queries'

export function ProvenancePage() {
  const [draft, setDraft] = useState('')
  const [revisionId, setRevisionId] = useState<string | null>(null)
  const query = useProvenance(revisionId)
  return (
    <div className="dashboard-stack">
      <Panel title="Restricted provenance lookup" icon={FileLock2} help="Internal evidence and lineage are available only to this local super-admin session and are never returned by public MCP tools.">
        <form className="provenance-search" onSubmit={(event) => {
          event.preventDefault()
          setRevisionId(draft.trim() || null)
        }}>
          <label className="search-field"><Search size={18} /><input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Paste a knowledge revision UUID…" /></label>
          <Button variant="primary" type="submit" disabled={!draft.trim()}>Load provenance</Button>
        </form>
      </Panel>
      {!revisionId && (
        <Panel title="Evidence remains private" icon={Fingerprint} help="Search begins only after an exact revision identifier is provided.">
          <EmptyState>Choose a revision from Knowledge, then paste its full UUID here.</EmptyState>
        </Panel>
      )}
      {revisionId && query.isLoading && <LoadingState label="Loading restricted evidence…" />}
      {revisionId && query.isError && <ErrorState onRetry={() => void query.refetch()}>No provenance record is available for this revision.</ErrorState>}
      {query.data && (
        <Panel title="Revision provenance" icon={History} help="Internal structured evidence, source linkage and the reason for assigned confidence.">
          <KeyValue items={[
            { label: 'Revision', value: <code title={query.data.revision_id}>{shortId(query.data.revision_id)}</code> },
            { label: 'Status', value: <Status>{titleCase(query.data.status)}</Status> },
            { label: 'Recorded', value: formatDate(query.data.created_at) }
          ]} />
          <pre className="provenance-json">{JSON.stringify(query.data.provenance, null, 2)}</pre>
        </Panel>
      )}
    </div>
  )
}
