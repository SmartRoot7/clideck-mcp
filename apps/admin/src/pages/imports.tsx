import type { ImportRun } from '@clideck/admin-contracts'
import {
  CheckCircle2,
  FileWarning,
  Import,
  PackageCheck
} from 'lucide-react'

import {
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
  numberOf,
  shortId,
  titleCase
} from '../lib/format'
import { useImports } from '../lib/queries'

export function ImportsPage() {
  const query = useImports()
  if (query.isLoading) return <LoadingState label="Loading import reconciliation…" />
  if (query.isError || !query.data) return <ErrorState onRetry={() => void query.refetch()}>Import data is unavailable.</ErrorState>
  const rows = query.data
  const totals = rows.reduce((state, row) => ({
    seen: state.seen + numberOf(row.records_seen),
    published: state.published + numberOf(row.records_published),
    failed: state.failed + numberOf(row.records_failed)
  }), { seen: 0, published: 0, failed: 0 })
  return (
    <div className="dashboard-stack">
      <section className="metric-grid metric-grid--four">
        <Metric label="Import runs" value={rows.length} icon={Import} help="Read-only legacy import executions recorded by the new system." />
        <Metric label="Records seen" value={compactNumber(totals.seen)} icon={PackageCheck} help="Legacy records accounted for by all visible manifests." />
        <Metric label="Records published" value={compactNumber(totals.published)} icon={CheckCircle2} help="Imported revisions included in immutable releases." tone="good" />
        <Metric label="Records failed" value={totals.failed} icon={FileWarning} help="Legacy records that could not be reconciled or imported." tone={totals.failed ? 'danger' : 'good'} />
      </section>
      <Panel title="Legacy import reconciliation" icon={Import} help="Manifest integrity, resumable processing and the final mapping from legacy records to immutable revisions.">
        <DataTable rows={rows} columns={IMPORT_COLUMNS} rowKey={(row) => row.id} empty="No legacy imports have been recorded." />
      </Panel>
    </div>
  )
}

const IMPORT_COLUMNS: Array<TableColumn<ImportRun>> = [
  { key: 'run', label: 'Import', render: (row) => <div className="primary-cell"><strong>{row.source_label}</strong><span>{formatDate(row.started_at)}</span><code title={row.manifest_hash ?? ''}>{shortId(row.manifest_hash)}</code></div> },
  { key: 'status', label: 'Status', render: (row) => <Status>{titleCase(row.status)}</Status> },
  { key: 'progress', label: 'Progress', render: (row) => {
    const seen = numberOf(row.records_seen)
    const done = numberOf(row.records_imported) + numberOf(row.records_quarantined) + numberOf(row.records_failed)
    return <div className="table-progress"><ProgressBar value={seen ? done / seen * 100 : 0} /><strong>{compactNumber(done)} / {compactNumber(seen)}</strong></div>
  } },
  { key: 'published', label: 'Published', render: (row) => compactNumber(row.records_published) },
  { key: 'mapped', label: 'Mapped revisions', render: (row) => compactNumber(row.mapped_revisions) },
  { key: 'quarantine', label: 'Quarantined', render: (row) => compactNumber(row.records_quarantined) },
  { key: 'failed', label: 'Failed', render: (row) => <span className={numberOf(row.records_failed) ? 'text-danger' : ''}>{compactNumber(row.records_failed)}</span> },
  { key: 'completed', label: 'Completed', render: (row) => formatDate(row.completed_at) }
]
