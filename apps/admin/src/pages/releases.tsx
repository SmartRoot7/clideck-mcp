import type { Release } from '@clideck/admin-contracts'
import {
  CheckCircle2,
  History,
  PackageOpen,
  Tag
} from 'lucide-react'

import { useAdminAction } from '../components/action-dialog'
import {
  Button,
  DataTable,
  ErrorState,
  LoadingState,
  Metric,
  Panel,
  Status,
  type TableColumn
} from '../components/ui'
import { formatDate, shortId, titleCase } from '../lib/format'
import { useReleases } from '../lib/queries'

export function ReleasesPage() {
  const query = useReleases()
  const action = useAdminAction()
  if (query.isLoading) return <LoadingState label="Loading immutable releases…" />
  if (query.isError || !query.data) return <ErrorState onRetry={() => void query.refetch()}>Release data is unavailable.</ErrorState>
  const active = query.data.find((row) => row.active)
  return (
    <div className="dashboard-stack">
      {action.dialog}{action.toast}
      <section className="metric-grid metric-grid--four">
        <Metric label="Active release" value={active ? `#${active.sequence}` : '—'} icon={Tag} help="The immutable release currently serving public MCP search." tone="good" />
        <Metric label="Active revisions" value={active?.revision_count ?? 0} icon={PackageOpen} help="Knowledge revisions present in the active release." />
        <Metric label="Release history" value={query.data.length} icon={History} help="Recent immutable release packages available to inspect or reactivate." />
        <Metric label="Activation state" value={active ? 'Healthy' : 'Missing'} icon={CheckCircle2} help="Whether exactly one knowledge release is currently active." tone={active ? 'good' : 'danger'} />
      </section>
      <Panel title="Knowledge releases" icon={Tag} help="Atomic knowledge snapshots. Activating an older release is an immediate rollback of public search content.">
        <DataTable rows={query.data} columns={RELEASE_COLUMNS} rowKey={(row) => row.id} empty="No knowledge releases have been created." actions={(row) => row.active ? <Status tone="good">Serving</Status> : (
          <Button variant="danger" onClick={() => action.open({
            title: `Activate release #${row.sequence}`,
            summary: `Atomically switch public MCP search to release #${row.sequence} containing ${row.revision_count} revisions. The current release remains immutable and can be restored.`,
            path: `/admin/api/v1/releases/${row.id}/activate`,
            confirmText: `ACTIVATE ${row.sequence}`,
            requireReason: true,
            danger: true,
            buildBody: (reason) => ({ reason })
          })}>Activate / rollback</Button>
        )} />
      </Panel>
    </div>
  )
}

const RELEASE_COLUMNS: Array<TableColumn<Release>> = [
  { key: 'sequence', label: 'Release', render: (row) => <div className="release-sequence"><strong>#{row.sequence}</strong>{row.active && <Status tone="good">Active</Status>}</div> },
  { key: 'reason', label: 'Package reason', render: (row) => <div className="primary-cell"><strong>{row.reason}</strong><span>Created by {row.created_by}</span></div> },
  { key: 'status', label: 'Status', render: (row) => <Status>{titleCase(row.status)}</Status> },
  { key: 'mode', label: 'Storage', render: (row) => <Status>{titleCase(row.release_mode)}</Status> },
  { key: 'changes', label: 'Changed', render: (row) => row.changed_records },
  { key: 'revisions', label: 'Revisions', render: (row) => row.revision_count },
  { key: 'created', label: 'Created', render: (row) => formatDate(row.created_at) },
  { key: 'id', label: 'Release ID', render: (row) => <code title={row.id}>{shortId(row.id)}</code> }
]
