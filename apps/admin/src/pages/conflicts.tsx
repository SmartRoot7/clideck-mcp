import type { Conflict } from '@clideck/admin-contracts'
import {
  CheckCheck,
  GitCompareArrows,
  ShieldAlert
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
import { useConflicts } from '../lib/queries'

export function ConflictsPage() {
  const query = useConflicts()
  const action = useAdminAction()
  if (query.isLoading) return <LoadingState label="Loading knowledge conflicts…" />
  if (query.isError || !query.data) return <ErrorState onRetry={() => void query.refetch()}>Conflict data is unavailable.</ErrorState>
  const open = query.data.filter((row) => row.status === 'open')
  const critical = open.filter((row) => row.severity === 'critical' || row.severity === 'high')
  return (
    <div className="dashboard-stack">
      {action.dialog}{action.toast}
      <section className="metric-grid metric-grid--four">
        <Metric label="Open conflicts" value={open.length} icon={GitCompareArrows} help="Knowledge disagreements that block or qualify publication." tone={open.length ? 'warning' : 'good'} />
        <Metric label="High severity" value={critical.length} icon={ShieldAlert} help="Open conflicts with high or critical operational impact." tone={critical.length ? 'danger' : 'good'} />
        <Metric label="Resolved" value={query.data.filter((row) => row.status === 'resolved').length} icon={CheckCheck} help="Conflicts closed by verification or an explicit audited decision." tone="good" />
        <Metric label="Total records" value={query.data.length} icon={GitCompareArrows} help="Recent conflict records returned by the knowledge engine." />
      </section>
      <Panel title="Knowledge conflicts" icon={GitCompareArrows} help="Disagreements between immutable revisions. Decisions never delete the underlying evidence.">
        <DataTable rows={query.data} columns={CONFLICT_COLUMNS} rowKey={(row) => row.id} empty="No knowledge conflicts have been recorded." actions={(row) => row.status === 'open' ? (
          <div className="row-actions">
            <Button variant="primary" onClick={() => action.open({
              title: 'Resolve conflict',
              summary: 'Mark this disagreement resolved after reviewing both revisions. The decision and reason are audited.',
              path: `/admin/api/v1/conflicts/${row.id}/decision`,
              confirmText: 'RESOLVE',
              requireReason: true,
              buildBody: (reason) => ({ decision: 'resolved', reason })
            })}>Resolve</Button>
            <Button variant="secondary" onClick={() => action.open({
              title: 'Accept documented conflict',
              summary: 'Keep both revisions while recording that their difference is intentional and understood.',
              path: `/admin/api/v1/conflicts/${row.id}/decision`,
              confirmText: 'ACCEPT',
              requireReason: true,
              buildBody: (reason) => ({ decision: 'accepted', reason })
            })}>Accept</Button>
          </div>
        ) : null} />
      </Panel>
    </div>
  )
}

const CONFLICT_COLUMNS: Array<TableColumn<Conflict>> = [
  { key: 'description', label: 'Conflict', render: (row) => <div className="primary-cell conflict-description"><strong>{row.description.split('\n')[0]}</strong><span>{formatDate(row.created_at)}</span></div> },
  { key: 'severity', label: 'Severity', render: (row) => <Status tone={row.severity === 'high' || row.severity === 'critical' ? 'danger' : 'warning'}>{titleCase(row.severity)}</Status> },
  { key: 'status', label: 'Status', render: (row) => <Status>{titleCase(row.status)}</Status> },
  { key: 'left', label: 'Revision A', render: (row) => <code title={row.left_revision_id}>{shortId(row.left_revision_id)}</code> },
  { key: 'right', label: 'Revision B', render: (row) => <code title={row.right_revision_id}>{shortId(row.right_revision_id)}</code> },
  { key: 'resolved', label: 'Resolved', render: (row) => formatDate(row.resolved_at) }
]
