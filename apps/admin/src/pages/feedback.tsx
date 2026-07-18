import {
  MessageSquareText,
  Star,
  Tags,
  ThumbsUp
} from 'lucide-react'

import {
  DataTable,
  ErrorState,
  LoadingState,
  Metric,
  Panel,
  Status
} from '../components/ui'
import { formatDate, formatNumber, shortId, titleCase } from '../lib/format'
import { useFeedback } from '../lib/queries'

export function FeedbackPage() {
  const query = useFeedback()
  if (query.isLoading) return <LoadingState label="Loading feedback…" />
  if (query.isError || !query.data) return <ErrorState onRetry={() => void query.refetch()}>Feedback data is unavailable.</ErrorState>
  const rows = query.data
  const ratings = rows.flatMap((row) => row.rating === null ? [] : [row.rating])
  const average = ratings.length ? ratings.reduce((sum, value) => sum + value, 0) / ratings.length : 0
  const categories = new Set(rows.map((row) => row.category)).size
  return (
    <div className="dashboard-stack">
      <section className="metric-grid metric-grid--four">
        <Metric label="Feedback records" value={rows.length} icon={MessageSquareText} help="Recent operator and user feedback returned by the admin service." />
        <Metric label="Rated records" value={ratings.length} icon={Star} help="Feedback entries that include a numeric rating." />
        <Metric label="Average rating" value={ratings.length ? formatNumber(average, 2) : '—'} icon={ThumbsUp} help="Average numeric rating among the loaded feedback records." tone={average >= 4 ? 'good' : average ? 'warning' : 'neutral'} />
        <Metric label="Categories" value={categories} icon={Tags} help="Distinct feedback reasons in the loaded set." />
      </section>
      <Panel title="Feedback ledger" icon={MessageSquareText} help="Feedback linked to a knowledge revision or expert task. Contribution bodies and private logs are never exposed here.">
        <DataTable rows={rows} columns={[
          { key: 'feedback', label: 'Feedback', render: (row) => <div className="primary-cell"><strong>{row.comment ?? 'No written comment'}</strong><span>{formatDate(row.created_at)}</span></div> },
          { key: 'category', label: 'Category', render: (row) => <Status>{titleCase(row.category)}</Status> },
          { key: 'rating', label: 'Rating', render: (row) => row.rating === null ? '—' : `${row.rating} / 5` },
          { key: 'revision', label: 'Revision', render: (row) => <code title={row.revision_id ?? ''}>{shortId(row.revision_id)}</code> },
          { key: 'task', label: 'Expert task', render: (row) => <code title={row.task_id ?? ''}>{shortId(row.task_id)}</code> },
          { key: 'id', label: 'Feedback ID', render: (row) => <code title={row.id}>{shortId(row.id)}</code> }
        ]} rowKey={(row) => row.id} empty="No feedback has been submitted." />
      </Panel>
    </div>
  )
}
