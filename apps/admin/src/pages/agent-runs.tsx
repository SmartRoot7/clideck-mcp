import type { AgentRun, Overview } from '@clideck/admin-contracts'
import {
  Bot,
  CircleDollarSign,
  Clock3,
  Gauge,
  Layers3
} from 'lucide-react'
import { useState } from 'react'

import { Chart } from '../components/chart'
import {
  DataTable,
  ErrorState,
  LoadingState,
  Metric,
  Panel,
  Status,
  type TableColumn
} from '../components/ui'
import {
  compactNumber,
  duration,
  formatDate,
  formatNumber,
  numberOf,
  shortId,
  titleCase
} from '../lib/format'
import { useAgentRuns } from '../lib/queries'

export function AgentRunsPage({ overview }: { overview: Overview }) {
  const query = useAgentRuns(200)
  const [status, setStatus] = useState('')
  if (query.isLoading) return <LoadingState label="Loading Luna run history…" />
  if (query.isError || !query.data) return <ErrorState onRetry={() => void query.refetch()}>Agent runs are unavailable.</ErrorState>
  const rows = status ? query.data.filter((row) => row.status === status) : query.data
  const total = query.data.reduce((sum, row) => sum + numberOf(row.total_tokens), 0)
  const published = query.data.reduce((sum, row) => sum + numberOf(row.published_revisions), 0)
  const averageDuration = query.data.length
    ? query.data.reduce((sum, row) => sum + numberOf(row.duration_ms), 0) / query.data.length
    : 0
  const option = runChart(query.data)
  return (
    <div className="dashboard-stack">
      <section className="metric-grid metric-grid--four">
        <Metric label="Active runs" value={overview.active_agent_runs} icon={Bot} help="Luna tasks whose execution is currently running." tone="good" />
        <Metric label="Tokens shown" value={compactNumber(total)} icon={CircleDollarSign} help="Total tokens consumed by the run rows currently loaded on this screen." />
        <Metric label="Revisions produced" value={published} icon={Layers3} help="Published revisions attributed to the loaded Luna runs." />
        <Metric label="Average duration" value={duration(averageDuration)} icon={Clock3} help="Average elapsed time of the loaded runs." tone="neutral" />
      </section>
      <Panel title="Token use and output" icon={Gauge} help="Run-level token consumption and published output. Runs with zero output remain visible so waste is obvious.">
        <Chart option={option} height={300} />
      </Panel>
      <Panel
        title="Luna run ledger"
        icon={Bot}
        help="Every ephemeral AI execution with its exact model, reasoning level, token use, duration and result."
        action={
          <label className="compact-filter">Status
            <select value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="">All</option>
              {['running', 'completed', 'failed', 'rejected', 'cancelled'].map((value) => <option value={value} key={value}>{titleCase(value)}</option>)}
            </select>
          </label>
        }
      >
        <DataTable rows={rows} columns={RUN_COLUMNS} rowKey={(row) => row.id} empty="No Luna runs match this filter." />
      </Panel>
    </div>
  )
}

const RUN_COLUMNS: Array<TableColumn<AgentRun>> = [
  { key: 'work', label: 'Run', render: (row) => <div className="primary-cell"><strong>{titleCase(row.task_type ?? row.stage)}</strong><span>{formatDate(row.started_at)}</span></div> },
  { key: 'status', label: 'Status', render: (row) => <Status>{titleCase(row.status)}</Status> },
  { key: 'model', label: 'Model', render: (row) => <span className="model-pill">{row.model} · {row.reasoning_effort}</span> },
  { key: 'tokens', label: 'Tokens', render: (row) => compactNumber(row.total_tokens) },
  { key: 'output', label: 'Published', render: (row) => formatNumber(row.published_revisions, 0) },
  { key: 'efficiency', label: 'Tokens / revision', render: (row) => row.tokens_per_revision === null ? '—' : compactNumber(row.tokens_per_revision) },
  { key: 'duration', label: 'Duration', render: (row) => duration(row.duration_ms) },
  { key: 'id', label: 'Run ID', render: (row) => <code title={row.id}>{shortId(row.id)}</code> }
]

function runChart(rows: AgentRun[]) {
  const latest = [...rows].reverse().slice(-30)
  return {
    tooltip: { trigger: 'axis' },
    grid: { left: 52, right: 48, top: 32, bottom: 48 },
    xAxis: {
      type: 'category',
      data: latest.map((row) => formatDate(row.started_at, false)),
      axisTick: { show: false },
      axisLine: { lineStyle: { color: '#d8dee9' } },
      axisLabel: { color: '#667085', interval: 4 }
    },
    yAxis: [
      { type: 'value', splitLine: { lineStyle: { color: '#edf0f5' } }, axisLabel: { formatter: compactNumber, color: '#667085' } },
      { type: 'value', splitLine: { show: false }, axisLabel: { color: '#667085' } }
    ],
    series: [
      { name: 'Tokens', type: 'bar', data: latest.map((row) => numberOf(row.total_tokens)), itemStyle: { color: '#0f5fff', borderRadius: [3, 3, 0, 0] }, barMaxWidth: 14 },
      { name: 'Published', type: 'line', yAxisIndex: 1, data: latest.map((row) => numberOf(row.published_revisions)), smooth: 0.25, lineStyle: { color: '#22a06b', width: 2 }, itemStyle: { color: '#22a06b' } }
    ]
  }
}
