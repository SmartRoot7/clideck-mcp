import type { Approval } from '@clideck/admin-contracts'
import {
  CheckCircle2,
  FileCheck2,
  ShieldAlert,
  XCircle
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
import { useApprovals } from '../lib/queries'

export function ApprovalsPage() {
  const query = useApprovals()
  const action = useAdminAction()
  if (query.isLoading) return <LoadingState label="Loading code approvals…" />
  if (query.isError || !query.data) return <ErrorState onRetry={() => void query.refetch()}>Approval data is unavailable.</ErrorState>
  const pending = query.data.filter((row) => row.status === 'pending' || row.status === 'approval_required')
  return (
    <div className="dashboard-stack">
      {action.dialog}{action.toast}
      <section className="metric-grid metric-grid--four">
        <Metric label="Awaiting decision" value={pending.length} icon={ShieldAlert} help="Code changes stopped at the mandatory human approval gate." tone={pending.length ? 'warning' : 'good'} />
        <Metric label="Approved" value={query.data.filter((row) => row.status === 'approved').length} icon={CheckCircle2} help="Visible requests explicitly approved by a super administrator." tone="good" />
        <Metric label="Rejected" value={query.data.filter((row) => row.status === 'rejected').length} icon={XCircle} help="Visible requests explicitly rejected by a super administrator." />
        <Metric label="Total requests" value={query.data.length} icon={FileCheck2} help="Recent code change approval records." />
      </section>
      <Panel title="Code change approvals" icon={FileCheck2} help="Network knowledge may recommend code changes, but execution cannot proceed without a separate audited human decision.">
        <DataTable rows={query.data} columns={APPROVAL_COLUMNS} rowKey={(row) => row.id} empty="No code changes are waiting for approval." actions={(row) => ['pending', 'approval_required'].includes(row.status) ? (
          <div className="row-actions">
            <Button variant="primary" onClick={() => action.open({
              title: 'Approve code change',
              summary: 'Approve this specific repository change after reviewing the summary and risk assessment.',
              path: `/admin/api/v1/approvals/${row.id}/decision`,
              confirmText: 'APPROVE',
              requireReason: true,
              buildBody: (reason) => ({ decision: 'approved', reason })
            })}>Approve</Button>
            <Button variant="danger" onClick={() => action.open({
              title: 'Reject code change',
              summary: 'Reject this proposed repository change. The workflow will stop and retain the audited decision.',
              path: `/admin/api/v1/approvals/${row.id}/decision`,
              confirmText: 'REJECT',
              requireReason: true,
              danger: true,
              buildBody: (reason) => ({ decision: 'rejected', reason })
            })}>Reject</Button>
          </div>
        ) : null} />
      </Panel>
    </div>
  )
}

const APPROVAL_COLUMNS: Array<TableColumn<Approval>> = [
  { key: 'request', label: 'Proposed change', render: (row) => <div className="primary-cell approval-summary"><strong>{row.summary}</strong><span>{row.repository}</span></div> },
  { key: 'risk', label: 'Risk assessment', render: (row) => row.risk_assessment },
  { key: 'status', label: 'Status', render: (row) => <Status>{titleCase(row.status)}</Status> },
  { key: 'requested', label: 'Requested by', render: (row) => <div className="primary-cell"><strong>{row.requested_by}</strong><span>{formatDate(row.created_at)}</span></div> },
  { key: 'decision', label: 'Decision', render: (row) => <div className="primary-cell"><strong>{row.decided_by ?? '—'}</strong><span>{row.decision_reason ?? ''}</span></div> },
  { key: 'id', label: 'ID', render: (row) => <code title={row.id}>{shortId(row.id)}</code> }
]
