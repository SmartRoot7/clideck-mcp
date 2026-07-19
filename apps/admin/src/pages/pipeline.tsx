import type { Overview, PipelineDetails } from '@clideck/admin-contracts'
import {
  AlertTriangle,
  Bot,
  Clock3,
  ListChecks,
  Network,
  Play,
  RotateCcw,
  ShieldCheck,
  Waypoints
} from 'lucide-react'
import { useMemo, useState } from 'react'

import { Chart } from '../components/chart'
import {
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
  compactNumber,
  formatDate,
  formatNumber,
  numberOf,
  shortId,
  titleCase,
  toneFor
} from '../lib/format'
import { usePipeline } from '../lib/queries'

export function PipelinePage({
  overview
}: {
  overview: Overview
}) {
  const query = usePipeline()
  const [status, setStatus] = useState('')
  if (query.isLoading) {
    return <LoadingState label="Loading pipeline state…" />
  }
  if (query.isError || !query.data) {
    return <ErrorState onRetry={() => void query.refetch()}>Pipeline data is unavailable.</ErrorState>
  }
  const pipeline = query.data
  const tasks = status
    ? pipeline.tasks.filter((task) => task.status === status)
    : pipeline.tasks
  const active = pipeline.tasks.filter((task) =>
    task.status === 'running' || task.status === 'claimed')
  const chartOption = pipelineChart(overview)
  return (
    <div className="dashboard-stack">
      <section className="metric-grid metric-grid--four">
        <Metric label="Queued work" value={overview.queued_tasks} icon={ListChecks} help="All expert and pipeline work waiting for a worker or Luna executor." />
        <Metric label="Active Luna" value={`${overview.active_luna_executors} / ${overview.max_concurrent_ai_runs}`} icon={Bot} help="AI tasks currently running versus the configured pool capacity." tone="good" />
        <Metric label="Stages / 24h" value={overview.completed_stages_24h} icon={Waypoints} help="Mechanical and AI pipeline stages completed over the rolling last 24 hours." />
        <Metric label="Failures / 24h" value={overview.failures_24h} icon={AlertTriangle} help="Stages that failed during the rolling last 24 hours." tone={numberOf(overview.failures_24h) ? 'danger' : 'good'} />
      </section>

      <Panel
        title="Knowledge record flow"
        icon={Network}
        help="All values are records, not task batches. Waiting and in-flight are live; passed, escalated and rejected cover the rolling last 24 hours."
        action={<Status tone={overview.pipeline_enabled ? 'good' : 'warning'}>{overview.pipeline_enabled ? 'Running' : 'Paused'}</Status>}
      >
        <Chart option={chartOption} height={320} />
        <div className="pipeline-legend">
          <span><i className="legend-swatch legend-swatch--completed" />Passed</span>
          <span><i className="legend-swatch legend-swatch--running" />In flight</span>
          <span><i className="legend-swatch legend-swatch--queued" />Waiting</span>
          <span><i className="legend-swatch legend-swatch--failed" />Rejected</span>
        </div>
      </Panel>

      <div className="overview-grid overview-grid--wide">
        <Panel title="Active work" icon={Play} help="Tasks that currently hold a lease and are being processed.">
          {active.length ? (
            <TaskTable rows={active.slice(0, 12)} />
          ) : <EmptyState>No task currently holds a live lease.</EmptyState>}
        </Panel>
        <Panel title="Queue by priority" icon={ShieldCheck} help="AI queue order is expert, medium review, verification, low review, analysis, then discovery. Mechanical work continues independently.">
          <div className="priority-stack">
            {[
              ['Expert', overview.queued_expert, 'Urgent user questions'],
              ['Deep Medium', overview.record_pipeline.find((stage) => stage.stage === 'deep_medium')?.waiting ?? 0, 'Escalated independent review'],
              ['Verify', overview.record_pipeline.find((stage) => stage.stage === 'verify')?.waiting ?? 0, 'Independent candidate checks'],
              ['Deep Low', overview.record_pipeline.find((stage) => stage.stage === 'deep_low')?.waiting ?? 0, 'Automatic ambiguity review'],
              ['Analyze', overview.queued_analyze, 'Reserved fragment batches'],
              ['Discover', overview.queued_discover, 'Coverage gaps and refresh']
            ].map(([label, value, detail], index) => (
              <article key={String(label)}>
                <span>{index + 1}</span>
                <div><strong>{String(label)}</strong><small>{String(detail)}</small></div>
                <b>{compactNumber(value as string | number)}</b>
              </article>
            ))}
          </div>
        </Panel>
      </div>

      <Panel
        title="Pipeline tasks"
        icon={ListChecks}
        help="The newest 200 stage tasks with lease, retry and failure information."
        action={
          <label className="compact-filter">
            Status
            <select value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="">All</option>
              {['queued', 'claimed', 'running', 'completed', 'failed', 'skipped', 'cancelled'].map((value) => (
                <option value={value} key={value}>{titleCase(value)}</option>
              ))}
            </select>
          </label>
        }
      >
        <TaskTable rows={tasks} />
      </Panel>

      <Panel title="Event timeline" icon={Clock3} help="Newest milestones, retries, failures and publications emitted by the coordinator and workers.">
        <DataTable
          rows={pipeline.events.slice(0, 100)}
          columns={[
            { key: 'time', label: 'Time', render: (row) => formatDate(row.created_at) },
            { key: 'stage', label: 'Stage', render: (row) => <Status tone={toneFor(row.event_type)}>{titleCase(row.stage)}</Status> },
            { key: 'event', label: 'Event', render: (row) => titleCase(row.event_type) },
            { key: 'message', label: 'Milestone', render: (row) => row.message },
            { key: 'task', label: 'Task', render: (row) => <code title={row.pipeline_task_id ?? ''}>{shortId(row.pipeline_task_id)}</code> }
          ]}
          rowKey={(row) => row.id}
          empty="No pipeline events have been recorded."
        />
      </Panel>
    </div>
  )
}

function TaskTable({
  rows
}: {
  rows: PipelineDetails['tasks']
}) {
  const columns: Array<TableColumn<PipelineDetails['tasks'][number]>> = [
    { key: 'type', label: 'Work', render: (row) => <div className="primary-cell"><strong>{titleCase(row.task_type)}</strong><span>{row.source_title ?? 'System task'}</span></div> },
    { key: 'stage', label: 'Stage', render: (row) => <Status>{titleCase(row.stage)}</Status> },
    { key: 'status', label: 'Status', render: (row) => <Status>{titleCase(row.status)}</Status> },
    { key: 'priority', label: 'Priority', render: (row) => formatNumber(row.priority, 0) },
    { key: 'owner', label: 'Executor', render: (row) => row.claim_owner ?? '—' },
    { key: 'attempts', label: 'Attempts', render: (row) => formatNumber(row.attempts, 0) },
    { key: 'updated', label: 'Updated', render: (row) => formatDate(row.updated_at) },
    { key: 'id', label: 'Task ID', render: (row) => <code title={row.id}>{shortId(row.id)}</code> }
  ]
  return <DataTable rows={rows} columns={columns} rowKey={(row) => row.id} empty="No tasks match this status." />
}

function pipelineChart(overview: Overview) {
  const rows = overview.record_pipeline
  const labels: Record<string, string> = {
    verify: 'Verify',
    deep_low: 'Deep Low',
    deep_medium: 'Deep Medium',
    ready: 'Ready',
    publish: 'Published'
  }
  return {
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    grid: { left: 50, right: 22, top: 26, bottom: 46 },
    xAxis: {
      type: 'category',
      data: rows.map((row) => labels[row.stage] ?? titleCase(row.stage)),
      axisTick: { show: false },
      axisLine: { lineStyle: { color: '#d8dee9' } },
      axisLabel: { color: '#475467', fontWeight: 600 }
    },
    yAxis: {
      type: 'value',
      splitLine: { lineStyle: { color: '#edf0f5' } },
      axisLabel: { color: '#667085' }
    },
    series: [
      { name: 'Passed', type: 'bar', stack: 'total', data: rows.map((row) => numberOf(row.passed_24h)), itemStyle: { color: '#22a06b' } },
      { name: 'In flight', type: 'bar', stack: 'total', data: rows.map((row) => numberOf(row.in_flight)), itemStyle: { color: '#0f5fff' } },
      { name: 'Waiting', type: 'bar', stack: 'total', data: rows.map((row) => numberOf(row.waiting)), itemStyle: { color: '#f5a524' } },
      { name: 'Rejected', type: 'bar', stack: 'total', data: rows.map((row) => numberOf(row.rejected_24h)), itemStyle: { color: '#d92d20' } }
    ]
  }
}
