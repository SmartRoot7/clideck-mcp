import {
  Beaker,
  CheckCircle2,
  FlaskConical,
  ShieldCheck
} from 'lucide-react'

import {
  DataTable,
  ErrorState,
  LoadingState,
  Metric,
  Panel,
  Status
} from '../components/ui'
import {
  formatDate,
  numberOf,
  shortId,
  titleCase
} from '../lib/format'
import { useLab } from '../lib/queries'

export function LabPage() {
  const query = useLab()
  if (query.isLoading) return <LoadingState label="Loading lab validation evidence…" />
  if (query.isError || !query.data) return <ErrorState onRetry={() => void query.refetch()}>Lab validation data is unavailable.</ErrorState>
  const lab = query.data
  const passed = lab.runs.filter((run) => run.status === 'passed').length
  const types = new Set(lab.runs.map((run) => run.validation_type)).size
  const currentSha = lab.runs[0]?.commit_sha
  return (
    <div className="dashboard-stack">
      <section className="metric-grid metric-grid--four">
        <Metric label="Validation runs" value={lab.runs.length} icon={Beaker} help="Stored Batfish and containerlab reports tied to revisions." />
        <Metric label="Passed" value={passed} icon={CheckCircle2} help="Visible lab validations that completed successfully." tone="good" />
        <Metric label="Validation types" value={types} icon={FlaskConical} help="Distinct static or runtime validation methods represented." />
        <Metric label="Latest commit" value={shortId(currentSha)} icon={ShieldCheck} help="Commit SHA bound to the newest imported validation report." tone="neutral" />
      </section>
      <Panel title="Validation coverage" icon={Beaker} help="Count of lab evidence by validation tool and status. A runtime badge is never inferred from static validation.">
        <div className="lab-counts">
          {lab.counts.map((row) => (
            <article key={`${row.validation_type}-${row.status}`}>
              <span><Beaker size={18} /></span>
              <div><strong>{titleCase(row.validation_type)}</strong><small>{titleCase(row.status)}</small></div>
              <b>{row.count}</b>
            </article>
          ))}
        </div>
      </Panel>
      <Panel title="Lab evidence" icon={FlaskConical} help="Hashed reports linked to the exact revision and CI commit that produced them.">
        <DataTable rows={lab.runs} columns={[
          { key: 'validation', label: 'Validation', render: (row) => <div className="primary-cell"><strong>{titleCase(row.validation_type)}</strong><span>{row.fixture_key}</span></div> },
          { key: 'status', label: 'Status', render: (row) => <Status>{titleCase(row.status)}</Status> },
          { key: 'summary', label: 'Summary', render: (row) => row.summary },
          { key: 'tool', label: 'Tool', render: (row) => row.tool_version },
          { key: 'revision', label: 'Knowledge', render: (row) => <div className="primary-cell"><strong>{row.stable_key}</strong><code title={row.revision_id}>{shortId(row.revision_id)}</code></div> },
          { key: 'commit', label: 'Commit / report', render: (row) => <div className="primary-cell"><code title={row.commit_sha}>{shortId(row.commit_sha)}</code><code title={row.report_hash}>{shortId(row.report_hash)}</code></div> },
          { key: 'time', label: 'Executed', render: (row) => formatDate(row.executed_at) }
        ]} rowKey={(row) => row.id} empty="No lab validations have been imported." />
      </Panel>
    </div>
  )
}
