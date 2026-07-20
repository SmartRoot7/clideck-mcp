import type { ActiveSourceDetail } from '@clideck/admin-contracts'
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
import { useActiveSource, useActiveSources } from '../lib/queries'

export function ActiveSourcePage() {
  const query = useActiveSource()
  const lanesQuery = useActiveSources()
  const [tab, setTab] = useState<'fragments' | 'candidates' | 'events'>('fragments')
  if (query.isLoading) return <LoadingState label="Loading the active source…" />
  if (query.isError) return <ErrorState onRetry={() => void query.refetch()}>Active source data is unavailable.</ErrorState>
  if (!query.data) return (
    <Panel title="Active source" icon={FileCheck2} help="The source currently moving through the knowledge factory.">
      <EmptyState>No source is active. The scheduler will choose the next coverage gap automatically.</EmptyState>
    </Panel>
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
      <Panel
        title="Active source lanes"
        icon={Layers3}
        help="Up to four independent documents move through extraction and verification concurrently, preventing one difficult source from idling Luna."
        action={<Status tone="good">{lanesQuery.data?.length ?? 0} active</Status>}
      >
        <div className="source-lanes">
          {(lanesQuery.data ?? []).map((lane) => {
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
          {!lanesQuery.isLoading && (lanesQuery.data?.length ?? 0) === 0 && (
            <EmptyState>No source lane is currently assigned.</EmptyState>
          )}
        </div>
      </Panel>
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
