import type { Quality } from '@clideck/admin-contracts'
import {
  AlertOctagon,
  Gauge,
  ShieldCheck,
  TestTube2
} from 'lucide-react'
import { Chart } from '../components/chart'
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
  formatNumber,
  numberOf,
  shortId,
  titleCase
} from '../lib/format'
import { useQuality } from '../lib/queries'

export function QualityPage() {
  const query = useQuality()
  if (query.isLoading) return <LoadingState label="Loading quality gates and evaluations…" />
  if (query.isError || !query.data) return <ErrorState onRetry={() => void query.refetch()}>Quality data is unavailable.</ErrorState>
  const quality = query.data
  const latest = quality.eval_runs[0]
  const chart = latencyChart(quality)
  return (
    <div className="dashboard-stack">
      <section className="metric-grid metric-grid--four">
        <Metric label="Average confidence" value={`${formatNumber(numberOf(quality.summary.avg_confidence) * 100, 1)}%`} icon={ShieldCheck} help="Mean confidence across active revisions." tone="good" />
        <Metric label="Average quality" value={`${formatNumber(numberOf(quality.summary.avg_quality) * 100, 1)}%`} icon={Gauge} help="Mean internal quality score across active revisions." tone="good" />
        <Metric label="Latest eval pass rate" value={latest ? `${formatNumber(numberOf(latest.passed_count) / Math.max(1, numberOf(latest.case_count)) * 100, 1)}%` : '—'} icon={TestTube2} help="Pass rate from the latest stored product evaluation suite." />
        <Metric label="Dangerous false-safe" value={latest?.dangerous_false_safe ?? 0} icon={AlertOctagon} help="Dangerous cases incorrectly classified as safe. The required value is always zero." tone={numberOf(latest?.dangerous_false_safe) ? 'danger' : 'good'} />
      </section>
      <div className="overview-grid overview-grid--wide">
        <Panel title="Operation latency · 30 days" icon={Gauge} help="Average response time by public MCP operation over the last 30 days.">
          <Chart option={chart} height={300} />
        </Panel>
        <Panel title="Confidence gates" icon={ShieldCheck} help="Safety threshold violations in the active release. Dangerous knowledge requires at least 0.95 confidence.">
          <div className="gate-list">
            <article><span>Dangerous revisions</span><strong>{quality.summary.dangerous_revisions}</strong></article>
            <article className={numberOf(quality.summary.dangerous_below_threshold) ? 'is-danger' : 'is-good'}><span>Dangerous below 0.95</span><strong>{quality.summary.dangerous_below_threshold}</strong></article>
            <article className={numberOf(quality.summary.regular_below_threshold) ? 'is-warning' : 'is-good'}><span>Regular below 0.90</span><strong>{quality.summary.regular_below_threshold}</strong></article>
            {quality.conflicts.map((row) => <article key={`${row.severity}-${row.status}`}><span>{titleCase(row.severity)} conflicts · {titleCase(row.status)}</span><strong>{row.count}</strong></article>)}
          </div>
        </Panel>
      </div>
      <Panel title="Evaluation history" icon={TestTube2} help="Versioned product evaluation reports with safety failures and measured latency.">
        <DataTable rows={quality.eval_runs} columns={[
          { key: 'suite', label: 'Suite', render: (row) => <div className="primary-cell"><strong>{row.suite}</strong><span>{formatDate(row.executed_at)}</span></div> },
          { key: 'result', label: 'Result', render: (row) => <Status tone={numberOf(row.failed_count) ? 'danger' : 'good'}>{row.passed_count} / {row.case_count} passed</Status> },
          { key: 'false-safe', label: 'False-safe', render: (row) => <span className={numberOf(row.dangerous_false_safe) ? 'text-danger' : ''}>{row.dangerous_false_safe}</span> },
          { key: 'latency', label: 'Latency p50 / p95 / max', render: (row) => `${row.p50_ms} / ${row.p95_ms} / ${row.max_ms} ms` },
          { key: 'commit', label: 'Commit', render: (row: Quality['eval_runs'][number]) => <code title={row.commit_sha ?? ''}>{shortId(row.commit_sha)}</code> },
          { key: 'report', label: 'Report', render: (row: Quality['eval_runs'][number]) => <code title={row.report_hash}>{shortId(row.report_hash)}</code> }
        ]} rowKey={(row) => String(row.id)} empty="No product evaluations have been imported." />
      </Panel>
    </div>
  )
}

function latencyChart(quality: Quality) {
  return {
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    grid: { left: 150, right: 28, top: 16, bottom: 30 },
    xAxis: { type: 'value', axisLabel: { formatter: '{value} ms', color: '#667085' }, splitLine: { lineStyle: { color: '#edf0f5' } } },
    yAxis: { type: 'category', data: quality.operation_latency_30d.map((row) => titleCase(row.operation)), axisTick: { show: false }, axisLine: { show: false }, axisLabel: { color: '#344054' } },
    series: [{ type: 'bar', data: quality.operation_latency_30d.map((row) => numberOf(row.average_ms)), itemStyle: { color: '#0f5fff', borderRadius: [0, 4, 4, 0] }, barMaxWidth: 15, label: { show: true, position: 'right', formatter: '{c} ms', color: '#475467' } }]
  }
}
