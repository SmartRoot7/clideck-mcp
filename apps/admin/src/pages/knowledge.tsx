import type { KnowledgeRevision } from '@clideck/admin-contracts'
import {
  BookOpen,
  Filter,
  Search,
  ShieldAlert,
  Tags
} from 'lucide-react'
import { useState } from 'react'

import {
  DataTable,
  ErrorState,
  LoadingState,
  Metric,
  Pagination,
  Panel,
  Status,
  type TableColumn
} from '../components/ui'
import {
  formatDate,
  formatNumber,
  numberOf,
  shortId,
  titleCase
} from '../lib/format'
import { useKnowledge, type KnowledgeFilters } from '../lib/queries'

const EMPTY_FILTERS: KnowledgeFilters = {
  q: '',
  vendor: '',
  operatingSystem: '',
  kind: '',
  risk: '',
  origin: '',
  family: '',
  scope: '',
  versionMatch: '',
  limit: 50,
  offset: 0
}

const FILTER_FIELDS: Array<{
  key: 'vendor' | 'operatingSystem' | 'kind' | 'risk' | 'origin' |
    'family' | 'scope' | 'versionMatch'
  label: string
  values: string[]
}> = [
  { key: 'vendor', label: 'Vendor', values: ['cisco', 'arista', 'juniper', 'dell', 'fortinet', 'sonic', 'nokia'] },
  { key: 'operatingSystem', label: 'Operating system', values: ['ios-xe', 'nx-os', 'ios-xr', 'asa', 'eos', 'junos', 'os10', 'fortios'] },
  { key: 'kind', label: 'Kind', values: ['command', 'diagnostic', 'workflow', 'change', 'upgrade'] },
  { key: 'risk', label: 'Risk', values: ['safe', 'low', 'medium', 'high', 'critical'] },
  { key: 'origin', label: 'Origin', values: ['native', 'legacy', 'expert'] },
  {
    key: 'family',
    label: 'Family',
    values: [
      'onie', 'sonic', 'openwrt', 'debian', 'linux-userspace',
      'linux-iproute2', 'linux-netfilter', 'cumulus-linux',
      'cisco-nx-os', 'cisco-ios-xe'
    ]
  },
  {
    key: 'scope',
    label: 'Scope',
    values: ['model', 'vendor_os', 'architecture', 'os_family']
  },
  {
    key: 'versionMatch',
    label: 'Version match',
    values: ['exact', 'range', 'branch', 'unbounded']
  }
]

export function KnowledgePage() {
  const [draft, setDraft] = useState(EMPTY_FILTERS)
  const [filters, setFilters] = useState(EMPTY_FILTERS)
  const query = useKnowledge(filters)
  if (query.isLoading && !query.data) return <LoadingState label="Searching active knowledge…" />
  if (query.isError || !query.data) return <ErrorState onRetry={() => void query.refetch()}>Knowledge search is unavailable.</ErrorState>
  const data = query.data
  const dangerous = data.items.filter((row) => row.dangerous).length
  const vendors = new Set(data.items.map((row) => row.vendor_slug)).size
  return (
    <div className="dashboard-stack">
      <section className="metric-grid metric-grid--four">
        <Metric label="Matching revisions" value={data.total} icon={BookOpen} help="Active revisions matching the current search and filters." />
        <Metric label="Rows on page" value={data.items.length} icon={Tags} help="Revisions loaded on this page of the result set." />
        <Metric label="Vendors on page" value={vendors} icon={Filter} help="Distinct vendors represented on the currently loaded page." />
        <Metric label="Dangerous on page" value={dangerous} icon={ShieldAlert} help="Loaded procedures requiring the stricter confidence threshold and safety controls." tone={dangerous ? 'warning' : 'good'} />
      </section>
      <Panel title="Knowledge search" icon={Search} help="PostgreSQL full-text and trigram search across the complete active immutable release.">
        <form className="knowledge-filters" onSubmit={(event) => {
          event.preventDefault()
          setFilters({ ...draft, offset: 0 })
        }}>
          <label className="search-field"><Search size={18} /><input aria-label="Search knowledge" value={draft.q} onChange={(event) => setDraft({ ...draft, q: event.target.value })} placeholder="Command, workflow, feature or diagnostic…" /></label>
          {FILTER_FIELDS.map(({ key, label, values }) => (
            <label className="field field--compact" key={key}>{label}
              <select value={draft[key]} onChange={(event) => setDraft({ ...draft, [key]: event.target.value })}>
                <option value="">All</option>
                {values.map((value) => <option value={value} key={value}>{titleCase(value)}</option>)}
              </select>
            </label>
          ))}
          <button className="button button--primary" type="submit">Apply filters</button>
          <button className="button button--secondary" type="button" onClick={() => {
            setDraft(EMPTY_FILTERS)
            setFilters(EMPTY_FILTERS)
          }}>Clear</button>
        </form>
      </Panel>
      <Panel title="Active revisions" icon={BookOpen} help="The searchable output of the active release. UUIDs are secondary; title and scope are the primary identifiers.">
        <DataTable rows={data.items} columns={KNOWLEDGE_COLUMNS} rowKey={(row) => row.revision_id} empty="No active knowledge matches these filters." />
        <Pagination offset={numberOf(data.offset)} limit={numberOf(data.limit)} total={numberOf(data.total)} onChange={(offset) => setFilters({ ...filters, offset })} />
      </Panel>
    </div>
  )
}

const KNOWLEDGE_COLUMNS: Array<TableColumn<KnowledgeRevision>> = [
  { key: 'knowledge', label: 'Knowledge', render: (row) => <div className="primary-cell knowledge-title"><strong>{row.title}</strong><span>{row.summary}</span><code title={row.stable_key}>{shortId(row.stable_key)}</code></div> },
  { key: 'scope', label: 'Scope', render: (row) => <div className="primary-cell"><strong>{row.vendor_name} · {row.operating_system_name ?? 'vendor-level'}</strong><span>{row.platform_name ?? 'Any platform'} · {row.version_min ?? '—'} to {row.version_max ?? '—'}</span><span>{titleCase(row.software_family_slug ?? 'unclassified')} · {titleCase(row.scope_level ?? 'legacy')} · {titleCase(row.version_scope ?? 'unbounded')}</span></div> },
  { key: 'kind', label: 'Kind', render: (row) => <Status>{titleCase(row.kind)}</Status> },
  { key: 'risk', label: 'Risk', render: (row) => row.dangerous
    ? <Status tone="danger">{titleCase(row.risk_level)}</Status>
    : <Status>{titleCase(row.risk_level)}</Status> },
  { key: 'trust', label: 'Trust', render: (row) => <div className="primary-cell"><strong>{formatNumber(numberOf(row.confidence) * 100, 1)}%</strong><span>{titleCase(row.validation_level)} · quality {formatNumber(numberOf(row.quality_score) * 100, 0)}%</span></div> },
  { key: 'origin', label: 'Origin', render: (row) => titleCase(row.origin) },
  { key: 'verified', label: 'Verified', render: (row) => formatDate(row.last_verified_at) },
  { key: 'id', label: 'Revision', render: (row) => <code title={row.revision_id}>{shortId(row.revision_id)}</code> }
]
