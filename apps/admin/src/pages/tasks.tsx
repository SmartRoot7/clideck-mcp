import type { ExpertTask } from '@clideck/admin-contracts'
import {
  Bot,
  CheckCircle2,
  Clock3,
  RotateCcw,
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
  ProgressBar,
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
import { useTasks } from '../lib/queries'

export function TasksPage() {
  const query = useTasks()
  const action = useAdminAction()
  if (query.isLoading) return <LoadingState label="Loading expert tasks…" />
  if (query.isError || !query.data) return <ErrorState onRetry={() => void query.refetch()}>Expert task data is unavailable.</ErrorState>
  const rows = query.data
  const queued = rows.filter((row) => row.status === 'queued').length
  const active = rows.filter((row) => row.status === 'running' || row.status === 'claimed').length
  const completed = rows.filter((row) => row.status === 'completed').length
  return (
    <div className="dashboard-stack">
      {action.dialog}{action.toast}
      <section className="metric-grid metric-grid--four">
        <Metric label="Queued" value={queued} icon={Clock3} help="Urgent user questions waiting for the next free Luna executor." tone={queued ? 'warning' : 'good'} />
        <Metric label="In progress" value={active} icon={Bot} help="Expert tasks currently researched or verified." tone="good" />
        <Metric label="Completed" value={completed} icon={CheckCircle2} help="Visible expert tasks that produced a final result." tone="good" />
        <Metric label="Failed / cancelled" value={rows.length - queued - active - completed} icon={XCircle} help="Visible tasks that stopped without a published answer." tone="neutral" />
      </section>
      <Panel title="Expert tasks" icon={Bot} help="User-triggered unknown questions pre-empt background AI work at the next available executor slot.">
        <DataTable rows={rows} columns={TASK_COLUMNS} rowKey={(row) => row.public_id} empty="No expert tasks have been created." actions={(row) => (
          <div className="row-actions">
            {['failed', 'cancelled', 'expired'].includes(row.status) && (
              <Button variant="secondary" onClick={() => action.open({
                title: 'Requeue expert task',
                summary: 'Return this task to the highest-priority expert queue. Previous failed execution artifacts are not reused.',
                path: `/admin/api/v1/tasks/${row.public_id}/action`,
                confirmText: 'REQUEUE',
                requireReason: true,
                buildBody: (reason) => ({ action: 'requeue', reason })
              })}><RotateCcw size={15} />Requeue</Button>
            )}
            {['queued', 'claimed', 'running', 'waiting_for_input'].includes(row.status) && (
              <Button variant="danger" onClick={() => action.open({
                title: 'Cancel expert task',
                summary: 'Stop this expert task. A currently running Luna process is allowed to terminate safely and its partial output is discarded.',
                path: `/admin/api/v1/tasks/${row.public_id}/action`,
                confirmText: 'CANCEL',
                requireReason: true,
                danger: true,
                buildBody: (reason) => ({ action: 'cancel', reason })
              })}>Cancel</Button>
            )}
          </div>
        )} />
      </Panel>
    </div>
  )
}

const TASK_COLUMNS: Array<TableColumn<ExpertTask>> = [
  { key: 'task', label: 'Expert task', render: (row) => <div className="primary-cell"><strong>{row.public_message ?? titleCase(row.stage ?? 'Queued research')}</strong><code title={row.public_id}>{shortId(row.public_id)}</code></div> },
  { key: 'status', label: 'Status', render: (row) => <Status>{titleCase(row.status)}</Status> },
  { key: 'stage', label: 'Stage', render: (row) => <div className="table-progress"><ProgressBar value={numberOf(row.progress_percent)} /><strong>{formatNumber(row.progress_percent, 0)}%</strong></div> },
  { key: 'priority', label: 'Priority', render: (row) => formatNumber(row.priority, 0) },
  { key: 'owner', label: 'Executor', render: (row) => row.claim_owner ?? '—' },
  { key: 'release', label: 'Result release', render: (row) => row.result_release_sequence === null ? '—' : `#${row.result_release_sequence}` },
  { key: 'updated', label: 'Updated', render: (row) => formatDate(row.updated_at) }
]
