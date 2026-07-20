import type { ReviewException } from '@clideck/admin-contracts'
import {
  ArchiveX,
  RefreshCw,
  SearchCheck,
  ShieldAlert
} from 'lucide-react'
import { useState } from 'react'

import { useAdminAction } from '../components/action-dialog'
import {
  Button,
  DataTable,
  EmptyState,
  ErrorState,
  LoadingState,
  Metric,
  Panel,
  Status,
  type TableColumn
} from '../components/ui'
import {
  formatDate,
  formatNumber,
  numberOf,
  titleCase
} from '../lib/format'
import {
  useReviewException,
  useReviewExceptions
} from '../lib/queries'

export function ReviewExceptionsPage() {
  const [status, setStatus] = useState<
    '' | 'manual_exception' | 'quarantined'
  >('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const query = useReviewExceptions(status)
  const detail = useReviewException(selectedId)
  const action = useAdminAction()
  if (query.isLoading) {
    return <LoadingState label="Loading automatic review outcomes…" />
  }
  if (query.isError || !query.data) {
    return (
      <ErrorState onRetry={() => void query.refetch()}>
        Review exception data is unavailable.
      </ErrorState>
    )
  }
  const manual = query.data.filter(
    (candidate) => candidate.status === 'manual_exception'
  )
  const quarantine = query.data.filter(
    (candidate) => candidate.status === 'quarantined'
  )
  return (
    <div className="dashboard-stack">
      {action.dialog}{action.toast}
      <section className="metric-grid metric-grid--four">
        <Metric
          label="Manual exceptions"
          value={manual.length}
          icon={ShieldAlert}
          help="Rare dangerous or high-value root causes that exhausted standard, low and medium automatic review."
          tone={manual.length > 3 ? 'danger' : manual.length ? 'warning' : 'good'}
        />
        <Metric
          label="Evidence pending"
          value={quarantine.length}
          icon={ArchiveX}
          help="Candidates with insufficient evidence. They are retried automatically after a source refresh or seven days."
        />
        <Metric
          label="Automatic path"
          value="3 passes"
          icon={SearchCheck}
          help="Extraction, standard verification and deep review complete before an item can appear here."
          tone="good"
        />
        <Metric
          label="Daily human cap"
          value="3"
          icon={ShieldAlert}
          help="A source refresh is already scheduled because the current extracted evidence is incomplete."
        />
      </section>

      <Panel
        title="Review exceptions"
        icon={ShieldAlert}
        help="This is an emergency screen. Technical failures retry automatically, and unsupported claims are rejected rather than assigned to an operator."
        action={
          <select
            aria-label="Exception status"
            value={status}
            onChange={(event) => setStatus(event.target.value as typeof status)}
          >
            <option value="">All outcomes</option>
            <option value="manual_exception">Manual exceptions</option>
            <option value="quarantined">Evidence pending</option>
          </select>
        }
      >
        <DataTable
          rows={query.data}
          columns={COLUMNS}
          rowKey={(row) => row.id}
          empty="No review exceptions are waiting."
          actions={(row) => (
            <Button
              variant="secondary"
              onClick={() => setSelectedId(row.id)}
            >
              Inspect
            </Button>
          )}
        />
      </Panel>

      {selectedId && (
        <Panel
          title={detail.data?.candidate.stable_key ?? 'Candidate details'}
          icon={SearchCheck}
          help="The candidate payload and independent verification receipts used by the automatic policy gates."
          action={
            <Button variant="quiet" onClick={() => setSelectedId(null)}>
              Close
            </Button>
          }
        >
          {detail.isLoading && <LoadingState label="Loading evidence…" />}
          {detail.data && (
            <div className="exception-detail">
              <div className="exception-detail__summary">
                <Status tone={detail.data.candidate.dangerous ? 'danger' : 'warning'}>
                  {titleCase(detail.data.candidate.status)}
                </Status>
                <span>{detail.data.candidate.resolution_reason ?? 'No bounded reason was recorded.'}</span>
              </div>
              <pre>{JSON.stringify(detail.data.payload, null, 2)}</pre>
              <div className="row-actions">
                <Button onClick={() => action.open(actionSpec(
                  detail.data!.candidate,
                  'retry_deep'
                ))}>
                  <RefreshCw size={16} /> Retry deep
                </Button>
                <Button variant="primary" onClick={() => action.open(actionSpec(
                  detail.data!.candidate,
                  'publish'
                ))}>
                  Publish safely
                </Button>
                <Button variant="danger" onClick={() => action.open(actionSpec(
                  detail.data!.candidate,
                  'reject'
                ))}>
                  Reject
                </Button>
              </div>
            </div>
          )}
        </Panel>
      )}
    </div>
  )
}

function actionSpec(
  candidate: ReviewException,
  action: 'retry_deep' | 'publish' | 'reject'
) {
  const labels = {
    retry_deep: {
      title: 'Retry automatic deep review',
      confirmation: 'RETRY',
      summary: 'Return this candidate to a fresh low-pass Luna review.'
    },
    publish: {
      title: 'Publish through safety gates',
      confirmation: 'PUBLISH',
      summary: 'Mark the candidate verified. Schema, context and risk gates still run before publication.'
    },
    reject: {
      title: 'Reject candidate',
      confirmation: 'REJECT',
      summary: 'Exclude this candidate from publication while preserving its review history.'
    }
  }[action]
  return {
    title: labels.title,
    summary: labels.summary,
    path: `/admin/api/v1/review-exceptions/${candidate.id}/action`,
    confirmText: labels.confirmation,
    requireReason: true,
    danger: action === 'reject',
    buildBody: (reason: string) => ({ action, reason })
  }
}

const COLUMNS: Array<TableColumn<ReviewException>> = [
  {
    key: 'candidate',
    label: 'Candidate',
    render: (row) => (
      <div className="primary-cell">
        <strong>{row.stable_key}</strong>
        <span>{row.vendor_slug ?? 'Unknown'} · {row.operating_system_slug ?? 'Unscoped'}</span>
      </div>
    )
  },
  {
    key: 'status',
    label: 'Outcome',
    render: (row) => (
      <Status tone={row.status === 'manual_exception' ? 'danger' : 'warning'}>
        {titleCase(row.status)}
      </Status>
    )
  },
  {
    key: 'risk',
    label: 'Risk',
    render: (row) => (
      <Status tone={row.dangerous ? 'danger' : 'good'}>
        {row.dangerous ? 'Dangerous' : 'Regular'}
      </Status>
    )
  },
  {
    key: 'confidence',
    label: 'Confidence',
    render: (row) => `${formatNumber(numberOf(row.confidence) * 100, 1)}%`
  },
  {
    key: 'attempts',
    label: 'Passes',
    render: (row) => formatNumber(row.resolution_attempts, 0)
  },
  {
    key: 'retry',
    label: 'Next retry',
    render: (row) => formatDate(row.next_review_at)
  }
]
