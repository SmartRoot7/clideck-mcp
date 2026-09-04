import type { Source } from '@clideck/admin-contracts'
import {
  Database,
  FileCheck2,
  FileWarning,
  RotateCcw,
  Search,
  Trash2
} from 'lucide-react'
import { useState } from 'react'

import { useAdminAction } from '../components/action-dialog'
import {
  Button,
  DataTable,
  ErrorState,
  LoadingState,
  Metric,
  Panel,
  ProgressBar,
  Status,
  type TableColumn
} from '../components/ui'
import {
  compactNumber,
  formatDate,
  formatNumber,
  numberOf,
  shortId,
  titleCase
} from '../lib/format'
import { useSources } from '../lib/queries'

export function SourcesPage() {
  const [status, setStatus] = useState('')
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const query = useSources(status, 200)
  const action = useAdminAction()
  if (query.isLoading) return <LoadingState label="Loading discovered sources…" />
  if (query.isError || !query.data) return <ErrorState onRetry={() => void query.refetch()}>Source discovery data is unavailable.</ErrorState>
  const rows = query.data
  const failures = rows.filter((row) => row.failure_code).length
  const completed = rows.filter((row) => row.status === 'completed').length
  const fragments = rows.reduce((sum, row) => sum + numberOf(row.fragments_total), 0)
  return (
    <div className="dashboard-stack">
      {action.dialog}{action.toast}
      <section className="metric-grid metric-grid--four">
        <Metric label="Sources loaded" value={rows.length} icon={Database} help="Newest source candidates loaded under the current status filter." />
        <Metric label="Completed" value={completed} icon={FileCheck2} help="Sources whose fragments and candidates were fully accounted for and packaged." tone="good" />
        <Metric label="Fragments" value={compactNumber(fragments)} icon={Search} help="Fragments produced by the visible source artifacts." />
        <Metric label="With failures" value={failures} icon={FileWarning} help="Visible sources carrying a failure code or message." tone={failures ? 'danger' : 'good'} />
      </section>
      <Panel
        title="Source discovery"
        icon={Database}
        help="Public official documents found for coverage targets, their acquisition state and document-level processing progress."
        action={
          <div className="panel-actions">
            <label className="compact-filter">Status
              <select value={status} onChange={(event) => setStatus(event.target.value)}>
                <option value="">All statuses</option>
                {['discovered', 'approved', 'acquired', 'converted', 'analyzing', 'verifying', 'completed', 'failed', 'rejected'].map((value) => <option value={value} key={value}>{titleCase(value)}</option>)}
              </select>
            </label>
            <Button variant="primary" onClick={() => action.open({
              title: 'Run source discovery',
              path: '/admin/api/v1/pipeline/discover',
              buildBody: () => ({ coverage_target_id: null })
            })}><Search size={16} />Discover source</Button>
            <Button variant="secondary" disabled={selected.size === 0} onClick={() => action.open({
              title: 'Reprocess selected sources',
              path: '/admin/api/v1/intake/reprocess',
              buildBody: () => ({ source_ids: [...selected], confirmed: true })
            })}><RotateCcw size={15} />Reprocess selected ({selected.size})</Button>
          </div>
        }
      >
        <DataTable rows={rows} columns={sourceColumns(selected, (id, checked) => setSelected((current) => {
          const next = new Set(current)
          if (checked) next.add(id); else next.delete(id)
          return next
        }))} rowKey={(row) => row.id} empty="No sources match this status." actions={(row) => (
          <div className="row-actions">
            <Button variant="quiet" onClick={() => action.open({
              title: 'Reprocess source',
              path: '/admin/api/v1/intake/reprocess',
              buildBody: () => ({ source_ids: [row.id], confirmed: true })
            })}><RotateCcw size={15} />Reprocess</Button>
            <Button variant="quiet" onClick={() => action.open({
              title: 'Retry source',
              path: `/admin/api/v1/sources/${row.id}/action`,
              buildBody: (reason) => ({ action: 'retry', reason })
            })}><RotateCcw size={15} />Retry</Button>
            <Button variant="quiet" onClick={() => action.open({
              title: 'Skip source',
              path: `/admin/api/v1/sources/${row.id}/action`,
              buildBody: (reason) => ({ action: 'skip', reason })
            })}>Skip</Button>
            <Button variant="danger" onClick={() => action.open({
              title: 'Reject source',
              path: `/admin/api/v1/sources/${row.id}/action`,
              buildBody: (reason) => ({ action: 'reject', reason })
            })}><Trash2 size={15} />Reject</Button>
          </div>
        )} />
      </Panel>
    </div>
  )
}

function sourceColumns(
  selected: Set<string>,
  onToggle: (id: string, checked: boolean) => void,
): Array<TableColumn<Source>> { return [
  { key: 'select', label: 'Select', render: (row) => <input type="checkbox" aria-label={`Select ${row.title}`} checked={selected.has(row.id)} onChange={(event) => onToggle(row.id, event.target.checked)} /> },
  { key: 'source', label: 'Source', render: (row) => <div className="primary-cell"><strong>{row.title}</strong><span>{row.vendor_slug} · {row.operating_system_slug ?? 'vendor-level'} · {titleCase(row.document_role)}</span></div> },
  { key: 'status', label: 'Status', render: (row) => <div><Status>{titleCase(row.status)}</Status>{row.failure_code && <small className="cell-error">{row.failure_code}</small>}</div> },
  { key: 'progress', label: 'Fragments', render: (row) => {
    const total = numberOf(row.fragments_total)
    const done = numberOf(row.fragments_completed)
    return <div className="table-progress"><ProgressBar value={total ? done / total * 100 : 0} /><strong>{done} / {total}</strong></div>
  } },
  { key: 'artifact', label: 'Artifact', render: (row) => <div className="primary-cell"><strong>{row.artifact_status ? titleCase(row.artifact_status) : 'Not acquired'}</strong><span>{row.page_count ?? '—'} pages · {row.byte_size ? `${formatNumber(numberOf(row.byte_size) / 1_048_576, 1)} MB` : '—'}</span></div> },
  { key: 'updated', label: 'Updated', render: (row) => formatDate(row.updated_at) },
  { key: 'id', label: 'ID', render: (row) => <code title={row.id}>{shortId(row.id)}</code> }
] }
