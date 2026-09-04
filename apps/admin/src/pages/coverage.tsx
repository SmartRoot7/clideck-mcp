import type { CoverageTarget } from '@clideck/admin-contracts'
import {
  Activity,
  CalendarClock,
  Compass,
  Flag,
  Search
} from 'lucide-react'
import { useMemo, useState } from 'react'

import { Chart } from '../components/chart'
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
import { useCoverage } from '../lib/queries'

export function CoveragePage() {
  const query = useCoverage()
  const action = useAdminAction()
  const [vendor, setVendor] = useState('')
  if (query.isLoading) return <LoadingState label="Loading the coverage planner…" />
  if (query.isError || !query.data) return <ErrorState onRetry={() => void query.refetch()}>Coverage data is unavailable.</ErrorState>
  const coverage = query.data
  const vendors = [...new Set(coverage.map((row) => row.vendor_slug))].sort()
  const rows = vendor ? coverage.filter((row) => row.vendor_slug === vendor) : coverage
  const average = rows.length ? rows.reduce((sum, row) => sum + numberOf(row.coverage_percent), 0) / rows.length : 0
  const due = rows.filter((row) => new Date(row.next_check_at) <= new Date()).length
  const chart = coverageChart(rows)
  const columns: Array<TableColumn<CoverageTarget>> = [
    { key: 'target', label: 'Coverage target', render: (row) => <div className="primary-cell"><strong>{row.vendor_slug} · {row.operating_system_slug ?? 'Vendor-level'}</strong><span>{row.model ?? row.product_family ?? titleCase(row.document_role)} · {row.version_branch ?? 'all versions'}</span></div> },
    { key: 'role', label: 'Document', render: (row) => titleCase(row.document_role) },
    { key: 'coverage', label: 'Evidence stage', render: (row) => <div className="table-progress"><ProgressBar value={numberOf(row.coverage_percent)} tone={numberOf(row.coverage_percent) >= 75 ? 'good' : numberOf(row.coverage_percent) >= 40 ? 'warning' : 'danger'} /><strong>{formatNumber(row.coverage_percent, 0)}%</strong></div> },
    { key: 'priority', label: 'Priority', render: (row) => formatNumber(row.priority, 0) },
    { key: 'sources', label: 'Sources', render: (row) => `${row.completed_sources} / ${row.source_count}` },
    { key: 'status', label: 'Status', render: (row) => <Status>{row.status === 'covered' ? 'Pass complete' : titleCase(row.status)}</Status> },
    { key: 'next', label: 'Next check', render: (row) => formatDate(row.next_check_at) },
    { key: 'id', label: 'ID', render: (row) => <code title={row.id}>{shortId(row.id)}</code> }
  ]
  return (
    <div className="dashboard-stack">
      {action.dialog}{action.toast}
      <section className="metric-grid metric-grid--four">
        <Metric label="Coverage targets" value={coverage.length} icon={Compass} help="Managed vendor, model, OS, version and document coverage goals." />
        <Metric label="Average evidence stage" value={`${Math.round(average)}%`} icon={Activity} help="A pipeline milestone, not the percentage of every possible manual: 5% means a source was found; 25% means it produced knowledge." />
        <Metric label="Due for refresh" value={due} icon={CalendarClock} help="Targets whose next discovery or freshness check is due now." tone={due ? 'warning' : 'good'} />
        <Metric label="Vendors planned" value={vendors.length} icon={Flag} help="Distinct vendors currently represented in the planner." />
      </section>
      <Panel title="Coverage heatmap" icon={Activity} help="Average evidence stage for the 20 largest vendor and operating-system groups. This avoids a chart made only from isolated zero-value targets.">
        <Chart option={chart} height={Math.max(260, Math.min(560, rows.length * 24))} />
      </Panel>
      <Panel
        title="Coverage planner"
        icon={Compass}
        help="Priorities control what the discovery scheduler researches next. “Pass complete” means the latest discovery pass ended; it never means fully learned, and the scheduler revisits the target."
        action={
          <div className="panel-actions">
            <label className="compact-filter">Vendor
              <select value={vendor} onChange={(event) => setVendor(event.target.value)}>
                <option value="">All vendors</option>
                {vendors.map((value) => <option value={value} key={value}>{value}</option>)}
              </select>
            </label>
            <Button variant="primary" onClick={() => action.open({
              title: 'Run source discovery',
              path: '/admin/api/v1/pipeline/discover',
              buildBody: () => ({ coverage_target_id: null })
            })}><Search size={16} />Run discovery</Button>
          </div>
        }
      >
        <DataTable
          rows={rows}
          columns={columns}
          rowKey={(row) => row.id}
          empty="No coverage targets match this filter."
          actions={(row: CoverageTarget) => (
            <div className="row-actions">
              <Button variant="quiet" onClick={() => action.open({
                title: 'Increase coverage priority',
                path: `/admin/api/v1/coverage/${row.id}/priority`,
                buildBody: () => ({ priority: Math.min(100, numberOf(row.priority) + 10) })
              })}>Prioritize</Button>
              <Button variant="quiet" onClick={() => action.open({
                title: 'Discover this target',
                path: '/admin/api/v1/pipeline/discover',
                buildBody: () => ({ coverage_target_id: row.id })
              })}>Discover</Button>
            </div>
          )}
        />
      </Panel>
    </div>
  )
}

export function coverageChart(rows: CoverageTarget[]) {
  const groups = new Map<string, {
    label: string
    coverageTotal: number
    sourceCount: number
    targetCount: number
  }>()
  for (const row of rows) {
    const label = `${row.vendor_slug} · ${row.operating_system_slug ?? 'vendor'}`
    const group = groups.get(label) ?? {
      label,
      coverageTotal: 0,
      sourceCount: 0,
      targetCount: 0
    }
    group.coverageTotal += numberOf(row.coverage_percent)
    group.sourceCount += numberOf(row.source_count)
    group.targetCount += 1
    groups.set(label, group)
  }
  const visible = [...groups.values()]
    .sort((left, right) =>
      right.targetCount - left.targetCount ||
      right.sourceCount - left.sourceCount ||
      left.label.localeCompare(right.label),
    )
    .slice(0, 20)
    .map((group) => ({
      ...group,
      coverage: Math.round(group.coverageTotal / group.targetCount)
    }))
    .sort((left, right) => left.coverage - right.coverage)
  return {
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    grid: { left: 150, right: 35, top: 12, bottom: 30 },
    xAxis: {
      type: 'value',
      max: 100,
      axisLabel: { formatter: '{value}%', color: '#667085' },
      splitLine: { lineStyle: { color: '#edf0f5' } }
    },
    yAxis: {
      type: 'category',
      data: visible.map((group) => group.label),
      axisTick: { show: false },
      axisLine: { show: false },
      axisLabel: { color: '#344054', fontWeight: 600 }
    },
    series: [{
      type: 'bar',
      data: visible.map((group) => ({
        value: group.coverage,
        itemStyle: { color: group.coverage >= 75 ? '#22a06b' : group.coverage >= 40 ? '#f5a524' : '#d92d20' }
      })),
      barMaxWidth: 14,
      itemStyle: { borderRadius: [0, 4, 4, 0] },
      label: { show: true, position: 'right', formatter: '{c}%', color: '#475467' }
    }]
  }
}
