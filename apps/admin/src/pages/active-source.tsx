import type {
  ActiveSourceDetail,
  ActiveSourceLane,
  PipelineTask
} from '@clideck/admin-contracts'
import {
  AlertTriangle,
  FileCheck2,
  FileStack,
  Layers3,
  ShieldCheck
} from 'lucide-react'
import { useState } from 'react'

import {
  DataTable,
  EmptyState,
  ErrorState,
  KeyValue,
  LoadingState,
  Metric,
  Panel,
  ProgressBar,
  Status
} from '../components/ui'
import {
  formatDate,
  formatNumber,
  numberOf,
  shortId,
  titleCase
} from '../lib/format'
import {
  useActiveSource,
  useActiveSources,
  usePipeline
} from '../lib/queries'

export function ActiveSourcePage() {
  const query = useActiveSource()
  const lanesQuery = useActiveSources()
  const pipelineQuery = usePipeline()
  const [tab, setTab] = useState<'fragments' | 'candidates' | 'events'>('fragments')
  if (query.isLoading) return <LoadingState label="Loading the active source…" />
  if (query.isError) return <ErrorState onRetry={() => void query.refetch()}>Active source data is unavailable.</ErrorState>
  const liveTasks = (pipelineQuery.data?.tasks ?? []).filter(
    (task) =>
      ['queued', 'claimed', 'running'].includes(task.status) &&
      task.source_candidate_id !== null,
  )
  if (!query.data) return (
    <div className="dashboard-stack">
      <SourceLanesPanel lanes={lanesQuery.data ?? []} loading={lanesQuery.isLoading} />
      <LiveSourceWork tasks={liveTasks} loading={pipelineQuery.isLoading} />
      <Panel title="Extraction lanes are clear" icon={FileCheck2} help="A source can leave its extraction lane while its records continue through Verify, Deep Review and Publish.">
        <EmptyState>No source currently occupies a fragment-analysis lane. Live downstream source work remains visible above.</EmptyState>
      </Panel>
    </div>
  )
  const detail = query.data
  const source = detail.source
  const fragmentsTotal = numberOf(source.fragments_total)
  const fragmentsDone = numberOf(source.fragments_completed)
  const candidates = numberOf(source.candidates_total)
  const verified = numberOf(source.candidates_verified)
  const completion = fragmentsTotal ? (fragmentsDone / fragmentsTotal) * 100 : 0
  return (
    <div className="dashboard-stack">
      <SourceLanesPanel lanes={lanesQuery.data ?? []} loading={lanesQuery.isLoading} />
      <LiveSourceWork tasks={liveTasks} loading={pipelineQuery.isLoading} />
      <Panel
        title={source.title}
        icon={FileCheck2}
        help="The current document and the exact model, operating system and version scope it is intended to cover."
        action={<Status>{titleCase(source.status)}</Status>}
      >
        <div className="active-source-hero">
          <div>
            <span className="eyebrow">{source.vendor_slug} · {source.operating_system_slug ?? 'Vendor-level'}</span>
            <h2>{source.product_family ?? source.model ?? titleCase(source.document_role)}</h2>
            <p>{titleCase(source.document_type)} · {source.document_version ?? 'Unbounded version'} · {source.page_count ?? '—'} pages</p>
          </div>
          <div className="source-completion">
            <strong>{Math.round(completion)}%</strong>
            <span>fragments completed</span>
            <ProgressBar value={completion} label={`${Math.round(completion)}% complete`} />
          </div>
        </div>
        <KeyValue items={[
          { label: 'Artifact status', value: <Status>{source.artifact_status ?? 'Not acquired'}</Status> },
          { label: 'Document role', value: titleCase(source.document_role) },
          { label: 'Acquired', value: source.acquired_at, date: true },
          { label: 'Converted', value: source.converted_at, date: true },
          { label: 'Updated', value: source.updated_at, date: true },
          { label: 'Source ID', value: <code title={source.id}>{shortId(source.id)}</code> }
        ]} />
      </Panel>

      <section className="metric-grid metric-grid--four">
        <Metric label="Fragments" value={source.fragments_total} icon={FileStack} help="Deterministic source sections ready for batch analysis." />
        <Metric label="Processed" value={source.fragments_completed} icon={Layers3} help="Fragments already analyzed, verified, published or explicitly rejected." tone="good" />
        <Metric label="Candidates" value={source.candidates_total} icon={ShieldCheck} help="Original structured knowledge records extracted from this source." />
        <Metric label="Verified" value={source.candidates_verified} icon={ShieldCheck} help="Candidates that passed an independent Luna verification plus deterministic gates." tone={verified === candidates && candidates > 0 ? 'good' : 'warning'} />
      </section>

      {source.failure_message && (
        <div className="inline-alert inline-alert--danger">
          <AlertTriangle size={20} />
          <div><strong>{source.failure_code ?? 'Source failure'}</strong><span>{source.failure_message}</span></div>
        </div>
      )}

      <Panel
        title="Source workbench"
        icon={Layers3}
        help="Fragments, extracted candidates and source-specific pipeline events. Full source text is never exposed here."
        action={
          <div className="segmented">
            {(['fragments', 'candidates', 'events'] as const).map((value) => (
              <button type="button" className={tab === value ? 'is-active' : ''} onClick={() => setTab(value)} key={value}>{titleCase(value)}</button>
            ))}
          </div>
        }
      >
        {tab === 'fragments' && <FragmentTable detail={detail} />}
        {tab === 'candidates' && <CandidateTable detail={detail} />}
        {tab === 'events' && <EventTable detail={detail} />}
      </Panel>
    </div>
  )
}

function SourceLanesPanel({
  lanes,
  loading
}: {
  lanes: ActiveSourceLane[]
  loading: boolean
}) {
  return (
    <Panel
      title="Active source lanes"
      icon={Layers3}
      help="Up to four documents can occupy fragment-analysis lanes. A source leaves this panel as soon as extraction finishes, while downstream work remains visible separately."
      action={<Status tone={lanes.length > 0 ? 'good' : 'neutral'}>{lanes.length} active</Status>}
    >
      <div className="source-lanes">
        {lanes.map((lane) => {
          const total = numberOf(lane.fragments_total)
          const done = numberOf(lane.fragments_completed)
          const percent = total ? (done / total) * 100 : 0
          return (
            <article className="source-lane" key={lane.id}>
              <header>
                <span>Lane {formatNumber(lane.slot_number, 0)}</span>
                <Status>{titleCase(lane.status)}</Status>
              </header>
              <strong>{lane.title}</strong>
              <small>{lane.vendor_slug} · {lane.operating_system_slug ?? 'Vendor-level'} · {titleCase(lane.document_role)}</small>
              <ProgressBar value={percent} label={`${Math.round(percent)}% processed`} />
              <footer>
                <span>{formatNumber(lane.candidates_verified, 0)} verified</span>
                <span>{formatNumber(lane.candidates_deep_review, 0)} deep</span>
                <span>{formatNumber(lane.candidates_quarantined, 0)} evidence pending</span>
              </footer>
            </article>
          )
        })}
        {loading && <LoadingState label="Loading source lanes…" />}
        {!loading && lanes.length === 0 && (
          <EmptyState>No source currently occupies an extraction lane.</EmptyState>
        )}
      </div>
    </Panel>
  )
}

function LiveSourceWork({
  tasks,
  loading
}: {
  tasks: PipelineTask[]
  loading: boolean
}) {
  return (
    <Panel
      title="Live source work"
      icon={Layers3}
      help="All queued and running source-linked tasks, including Verify, Deep Review and Publish after a document has left its extraction lane."
      action={<Status tone={tasks.some((task) => task.status === 'running') ? 'good' : 'neutral'}>{tasks.filter((task) => task.status === 'running').length} running</Status>}
    >
      {loading
        ? <LoadingState label="Loading live source work…" />
        : (
          <DataTable
            rows={tasks.slice(0, 40)}
            columns={[
              {
                key: 'source',
                label: 'Source',
                render: (task) => (
                  <div className="primary-cell">
                    <strong>{task.source_title ?? 'Source-linked task'}</strong>
                    <code>{shortId(task.source_candidate_id ?? task.id)}</code>
                  </div>
                )
              },
              {
                key: 'stage',
                label: 'Stage',
                render: (task) => <Status tone={task.status === 'running' ? 'good' : 'info'}>{titleCase(task.stage)}</Status>
              },
              {
                key: 'state',
                label: 'State',
                render: (task) => titleCase(task.status)
              },
              {
                key: 'owner',
                label: 'Worker',
                render: (task) => task.claim_owner ?? 'Waiting for worker'
              },
              {
                key: 'attempts',
                label: 'Attempts',
                render: (task) => formatNumber(task.attempts, 0)
              },
              {
                key: 'updated',
                label: 'Updated',
                render: (task) => formatDate(task.updated_at)
              }
            ]}
            rowKey={(task) => task.id}
            empty="No source-linked task is currently queued or running."
          />
        )}
    </Panel>
  )
}

function FragmentTable({ detail }: { detail: NonNullable<ActiveSourceDetail> }) {
  return <DataTable rows={detail.fragments} columns={[
    { key: 'ordinal', label: '#', render: (row) => formatNumber(row.ordinal, 0) },
    { key: 'section', label: 'Section', render: (row) => <div className="primary-cell"><strong>{row.section_title ?? 'Untitled section'}</strong><span>{row.source_locator ?? 'No locator'}</span></div> },
    { key: 'status', label: 'Status', render: (row) => <Status>{titleCase(row.status)}</Status> },
    { key: 'attempts', label: 'Attempts', render: (row) => formatNumber(row.attempts, 0) },
    { key: 'hash', label: 'Content hash', render: (row) => <code title={row.content_hash}>{shortId(row.content_hash)}</code> },
    { key: 'updated', label: 'Updated', render: (row) => formatDate(row.updated_at) }
  ]} rowKey={(row) => row.id} empty="The source has not been chunked yet." />
}

function CandidateTable({ detail }: { detail: NonNullable<ActiveSourceDetail> }) {
  return <DataTable rows={detail.candidates} columns={[
    { key: 'knowledge', label: 'Candidate', render: (row) => <div className="primary-cell"><strong>{row.stable_key}</strong><span><code>{shortId(row.id)}</code></span></div> },
    { key: 'status', label: 'Status', render: (row) => <Status>{titleCase(row.status)}</Status> },
    { key: 'risk', label: 'Safety', render: (row) => <Status tone={row.dangerous ? 'danger' : 'good'}>{row.dangerous ? 'Dangerous' : 'Regular'}</Status> },
    { key: 'confidence', label: 'Confidence', render: (row) => formatNumber(numberOf(row.confidence) * 100, 1) + '%' },
    { key: 'quality', label: 'Quality', render: (row) => formatNumber(numberOf(row.quality_score) * 100, 1) + '%' },
    { key: 'updated', label: 'Updated', render: (row) => formatDate(row.updated_at) }
  ]} rowKey={(row) => row.id} empty="No candidates have been extracted yet." />
}

function EventTable({ detail }: { detail: NonNullable<ActiveSourceDetail> }) {
  return <DataTable rows={detail.events} columns={[
    { key: 'time', label: 'Time', render: (row) => formatDate(row.created_at) },
    { key: 'stage', label: 'Stage', render: (row) => <Status>{titleCase(row.stage)}</Status> },
    { key: 'event', label: 'Event', render: (row) => titleCase(row.event_type) },
    { key: 'message', label: 'Message', render: (row) => row.message }
  ]} rowKey={(row) => row.id} empty="No source-specific events have been recorded." />
}
