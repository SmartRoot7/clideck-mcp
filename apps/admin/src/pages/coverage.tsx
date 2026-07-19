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

export function CoveragePage({
  data,
  readOnly = false
}: {
  data?: CoverageTarget[]
  readOnly?: boolean
} = {}) {
  const query = useCoverage(!data)
  const action = useAdminAction()
  const [vendor, setVendor] = useState('')
  if (!data && query.isLoading) return <LoadingState label="Loading the coverage planner…" />
  if (!data && (query.isError || !query.data)) return <ErrorState onRetry={() => void query.refetch()}>Coverage data is unavailable.</ErrorState>
  const coverage = data ?? query.data!
  const vendors = [...new Set(coverage.map((row) => row.vendor_slug))].sort()
  const rows = vendor ? coverage.filter((row) => row.vendor_slug === vendor) : coverage
  const average = rows.length ? rows.reduce((sum, row) => sum + numberOf(row.coverage_percent), 0) / rows.length : 0
  const due = rows.filter((row) => new Date(row.next_check_at) <= new Date()).length
  const chart = coverageChart(rows)
  const columns: Array<TableColumn<CoverageTarget>> = [
    { key: 'target', label: 'Coverage target', render: (row) => <div className="primary-cell"><strong>{row.vendor_slug} · {row.operating_system_slug ?? 'Vendor-level'}</strong><span>{row.model ?? row.product_family ?? titleCase(row.document_role)} · {row.version_branch ?? 'all versions'}</span></div> },
    { key: 'role', label: 'Document', render: (row) => titleCase(row.document_role) },
    { key: 'coverage', label: 'Coverage', render: (row) => <div className="table-progress"><ProgressBar value={numberOf(row.coverage_percent)} tone={numberOf(row.coverage_percent) >= 75 ? 'good' : numberOf(row.coverage_percent) >= 40 ? 'warning' : 'danger'} /><strong>{formatNumber(row.coverage_percent, 0)}%</strong></div> },
    { key: 'priority', label: 'Priority', render: (row) => formatNumber(row.priority, 0) },
    { key: 'sources', label: 'Sources', render: (row) => `${row.completed_sources} / ${row.source_count}` },
    { key: 'status', label: 'Status', render: (row) => <Status>{titleCase(row.status)}</Status> },
    { key: 'next', label: 'Next check', render: (row) => formatDate(row.next_check_at) },
    ...(!readOnly
      ? [{ key: 'id', label: 'ID', render: (row: CoverageTarget) => <code title={row.id}>{shortId(row.id)}</code> }]
      : [])
  ]
  return (
    <div className="dashboard-stack">
      {action.dialog}{action.toast}
      <section className="metric-grid metric-grid--four">
        <Metric label="Coverage targets" value={coverage.length} icon={Compass} help="Managed vendor, model, OS, version and document coverage goals." />
        <Metric label="Average coverage" value={`${Math.round(average)}%`} icon={Activity} help="Mean completeness across the targets visible under the current filter." />
        <Metric label="Due for refresh" value={due} icon={CalendarClock} help="Targets whose next discovery or freshness check is due now." tone={due ? 'warning' : 'good'} />
        <Metric label="Vendors planned" value={vendors.length} icon={Flag} help="Distinct vendors currently represented in the planner." />
      </section>
      <Panel title="Coverage heatmap" icon={Activity} help="Completeness by vendor and operating system. Low bars identify the next useful research opportunities.">
        <Chart option={chart} height={Math.max(260, Math.min(560, rows.length * 24))} />
      </Panel>
      <Panel
        title="Coverage planner"
        icon={Compass}
        help="Priorities control what the discovery scheduler researches next. Completed areas automatically return for freshness checks."
        action={
          <div className="panel-actions">
            <label className="compact-filter">Vendor
              <select value={vendor} onChange={(event) => setVendor(event.target.value)}>
                <option value="">All vendors</option>
                {vendors.map((value) => <option value={value} key={value}>{value}</option>)}
              </select>
            </label>
            {!readOnly && <Button variant="primary" onClick={() => action.open({
              title: 'Run source discovery',
              summary: vendor ? `Queue discovery for the highest-priority ${vendor} coverage gap.` : 'Queue discovery for the highest-priority coverage gap.',
              path: '/admin/api/v1/pipeline/discover',
              confirmText: 'DISCOVER',
              buildBody: () => ({ coverage_target_id: null })
            })}><Search size={16} />Run discovery</Button>}
          </div>
        }
      >
        <DataTable
          rows={rows}
          columns={columns}
          rowKey={(row) => row.id}
          empty="No coverage targets match this filter."
          {...(!readOnly
            ? {
                actions: (row: CoverageTarget) => (
                  <div className="row-actions">
                    <Button variant="quiet" onClick={() => action.open({
                      title: 'Increase coverage priority',
                      summary: `Raise ${row.vendor_slug} ${row.operating_system_slug ?? ''} ${row.document_role} to the front of its peer group.`,
                      path: `/admin/api/v1/coverage/${row.id}/priority`,
                      confirmText: 'PRIORITIZE',
                      buildBody: () => ({ priority: Math.min(100, numberOf(row.priority) + 10) })
                    })}>Prioritize</Button>
                    <Button variant="quiet" onClick={() => action.open({
                      title: 'Discover this target',
                      summary: `Create a discovery task specifically for ${row.vendor_slug} ${row.operating_system_slug ?? ''}.`,
                      path: '/admin/api/v1/pipeline/discover',
                      confirmText: 'DISCOVER',
                      buildBody: () => ({ coverage_target_id: row.id })
                    })}>Discover</Button>
                  </div>
                )
              }
            : {})}
        />
      </Panel>
    </div>
  )
}

function coverageChart(rows: CoverageTarget[]) {
  const sorted = [...rows].sort((left, right) => numberOf(left.coverage_percent) - numberOf(right.coverage_percent)).slice(0, 20)
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
      data: sorted.map((row) => `${row.vendor_slug} · ${row.operating_system_slug ?? 'vendor'}`),
      axisTick: { show: false },
      axisLine: { show: false },
      axisLabel: { color: '#344054', fontWeight: 600 }
    },
    series: [{
      type: 'bar',
      data: sorted.map((row) => ({
        value: numberOf(row.coverage_percent),
        itemStyle: { color: numberOf(row.coverage_percent) >= 75 ? '#22a06b' : numberOf(row.coverage_percent) >= 40 ? '#f5a524' : '#d92d20' }
      })),
      barMaxWidth: 14,
      itemStyle: { borderRadius: [0, 4, 4, 0] },
      label: { show: true, position: 'right', formatter: '{c}%', color: '#475467' }
    }]
  }
}
