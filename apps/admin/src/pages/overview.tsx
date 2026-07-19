import type {
  ActiveSourceDetail,
  CoverageTarget,
  Overview,
  PipelineDetails
} from '@clideck/admin-contracts'
import {
  AlertTriangle,
  BarChart3,
  BookOpen,
  Bot,
  Boxes,
  Clock3,
  Database,
  FileCheck2,
  Gauge,
  Layers3,
  Network,
  Pickaxe,
  ShieldCheck,
  Tag,
  TimerReset,
  Waypoints,
  type LucideIcon
} from 'lucide-react'
import { useMemo, type CSSProperties } from 'react'

import { Chart } from '../components/chart'
import {
  DataTable,
  EmptyState,
  ErrorState,
  IconTooltip,
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
  formatNumber,
  numberOf,
  shortId,
  titleCase,
  toneFor
} from '../lib/format'
import {
  useActiveSource,
  useCoverage,
  usePipeline
} from '../lib/queries'

export const PIPELINE_STAGES: Record<string, {
  label: string
  icon: LucideIcon
  waitingHelp: string
}> = {
  discover: {
    label: 'Discover',
    icon: Waypoints,
    waitingHelp: 'coverage targets ready for source discovery'
  },
  acquire: {
    label: 'Acquire',
    icon: Database,
    waitingHelp: 'approved sources waiting to be downloaded'
  },
  convert: {
    label: 'Convert',
    icon: FileCheck2,
    waitingHelp: 'downloaded documents waiting for deterministic conversion'
  },
  chunk: {
    label: 'Chunk',
    icon: Layers3,
    waitingHelp: 'converted documents waiting to be split into fragments'
  },
  analyze: {
    label: 'Analyze',
    icon: Bot,
    waitingHelp: 'fragments waiting for deterministic or Luna analysis'
  },
  verify: {
    label: 'Verify',
    icon: ShieldCheck,
    waitingHelp: 'knowledge candidates waiting for standard verification'
  },
  deep_review: {
    label: 'Deep Review',
    icon: ShieldCheck,
    waitingHelp: 'candidates waiting for automatic low or medium Luna review'
  },
  publish: {
    label: 'Publish',
    icon: Tag,
    waitingHelp: 'verified revisions in source packages ready to publish'
  }
}

export function OverviewPage({ overview }: { overview: Overview }) {
  const pipelineQuery = usePipeline()
  const sourceQuery = useActiveSource()
  const coverageQuery = useCoverage()
  const pipeline = pipelineQuery.data
  const source = sourceQuery.data
  const coverage = coverageQuery.data ?? []
  const publishedOption = usePublishedOption(overview)
  const activityOption = useActivityOption(overview)
  const tokensOption = useTokenOption(overview)
  const activeTotal = numberOf(overview.published_revisions)
  const activeExecutors = executorRows(overview)
  const deepReviewWaiting = overview.record_pipeline
    .filter((stage) =>
      stage.stage === 'deep_low' || stage.stage === 'deep_medium'
    )
    .reduce((total, stage) => total + numberOf(stage.waiting), 0)

  return (
    <div className="dashboard-stack">
      <Panel
        title="Published knowledge"
        icon={BarChart3}
        help="Verified revisions that became part of an immutable knowledge release. This is the primary output of the entire pipeline."
        className="published-panel"
        action={<Status tone="good">Live · 10s refresh</Status>}
      >
        <div className="hero-metrics">
          <Metric
            label="Published / 24h"
            value={overview.published_records_24h}
            icon={BarChart3}
            help="The number of verified knowledge records published during the last rolling 24 hours."
            detail="Rolling 24-hour output"
          />
          <Metric
            label="Active knowledge"
            value={overview.published_revisions}
            icon={BookOpen}
            help="All revisions available to public deterministic search in the currently active release."
            detail={`Release #${overview.active_release_sequence}`}
          />
          <Metric
            label="Active release"
            value={`#${overview.active_release_sequence}`}
            icon={Tag}
            help="The immutable knowledge snapshot currently serving all MCP queries."
            detail={formatDate(overview.active_release_created_at)}
          />
          <Metric
            label="Tokens today"
            value={compactNumber(overview.tokens_today)}
            icon={Bot}
            help="Input, output and reasoning tokens consumed by Luna since the start of the current day."
            detail={`${formatNumber(overview.tokens_per_revision)} / revision`}
            tone="neutral"
          />
          <Metric
            label="Failures / 24h"
            value={overview.failures_24h}
            icon={AlertTriangle}
            help="Pipeline stages that exhausted or recorded a failed execution during the last 24 hours."
            detail={`${overview.completed_stages_24h} completed stages`}
            tone={numberOf(overview.failures_24h) ? 'danger' : 'good'}
          />
        </div>
        <Chart option={publishedOption} height={285} />
        <div className="chart-footnote">
          <span>Hourly publications use your browser timezone.</span>
          <span>{activeTotal.toLocaleString()} revisions currently active.</span>
        </div>
      </Panel>

      <section className="metric-grid metric-grid--four">
        <Metric
          label="Projected / day"
          value={compactNumber(overview.projected_publications_per_day)}
          icon={TimerReset}
          help="Current hour publication rate projected across a full day. It is directional until the pipeline stabilises."
          detail="Rolling hourly projection"
          tone={numberOf(overview.projected_publications_per_day) >= 10_000 ? 'good' : 'warning'}
        />
        <Metric
          label="Automatic resolution"
          value={`${formatNumber(overview.automatic_resolution_rate, 2)}%`}
          icon={ShieldCheck}
          help="Candidates resolved without becoming ordinary human review work."
          detail={`${overview.manual_exceptions_24h} manual exceptions / 24h`}
          tone={numberOf(overview.automatic_resolution_rate) >= 99.9 ? 'good' : 'warning'}
        />
        <Metric
          label="Executor utilisation"
          value={`${formatNumber(overview.executor_utilization, 1)}%`}
          icon={Gauge}
          help="Share of available Luna execution time spent on useful claimed work during the last 24 hours."
          detail={`${overview.active_source_count}/${overview.max_active_sources} active · ${overview.prepared_sources}/${overview.prepared_source_target} prepared`}
          tone={numberOf(overview.executor_utilization) >= 85 ? 'good' : 'warning'}
        />
        <Metric
          label="Batch efficiency"
          value={`${formatNumber(overview.average_analysis_batch, 1)} / ${formatNumber(overview.average_verification_batch, 1)}`}
          icon={Boxes}
          help="Average fragments per analysis run and candidates per verification run over the last 24 hours."
          detail="Analysis / verification"
        />
        <Metric
          label="Deep resolved"
          value={overview.candidates_deep_resolved_24h}
          icon={Bot}
          help="Candidates automatically resolved by low or medium deep review in the last 24 hours."
          detail={`${formatNumber(deepReviewWaiting, 0)} waiting`}
          tone="good"
        />
        <Metric
          label="Discovery yield"
          value={overview.discovery_unique_yield}
          icon={Pickaxe}
          help="Unique approved official sources discovered during the last 24 hours."
          detail={`${overview.discovery_duplicates_avoided} duplicates avoided`}
        />
        <Metric
          label="Candidates / 24h"
          value={overview.candidates_created_24h}
          icon={Layers3}
          help="Structured candidates created by deterministic extraction or Luna during the last 24 hours."
          detail={`${overview.candidates_verified_24h} verification passes`}
        />
        <Metric
          label="Publication failures"
          value={overview.publication_failures_24h}
          icon={AlertTriangle}
          help="Source publication jobs that failed. Candidate-level validation errors are isolated and do not count here."
          detail="Last rolling 24 hours"
          tone={numberOf(overview.publication_failures_24h) ? 'danger' : 'good'}
        />
      </section>

      <PipelineRail overview={overview} />

      <section className="executor-grid" aria-label="Luna executor status">
        {activeExecutors.map((executor) => (
          <ExecutorCard
            key={executor.name}
            {...executor}
          />
        ))}
      </section>

      <div className="overview-grid">
        <ActiveSourceCard
          source={source}
          loading={sourceQuery.isLoading}
        />
        <Panel
          title="30-day publication trend"
          icon={BarChart3}
          help="Daily published records and new revisions over the latest 30 complete calendar days."
        >
          <Chart option={activityOption} height={245} />
        </Panel>
        <Panel
          title="Token efficiency"
          icon={Gauge}
          help="Daily Luna token consumption divided by the number of revisions published. Lower is more efficient."
        >
          <div className="efficiency-kpi">
            <strong>{formatNumber(overview.tokens_per_revision, 0)}</strong>
            <span>tokens per published revision</span>
          </div>
          <Chart option={tokensOption} height={190} />
        </Panel>
      </div>

      <div className="overview-grid overview-grid--wide">
        <CoverageHeatmap rows={coverage.slice(0, 8)} />
        <BreakdownPanel overview={overview} />
      </div>

      <div className="overview-grid overview-grid--wide">
        <RecentFailures overview={overview} />
        <RecentActivity
          pipeline={pipeline}
          loading={pipelineQuery.isLoading}
        />
      </div>
    </div>
  )
}

function usePublishedOption(overview: Overview) {
  return useMemo(() => {
    const rows = overview.published_hourly_24h
    const hourly = rows.map((row) => numberOf(row.published))
    const initial = Math.max(
      0,
      numberOf(overview.published_revisions) -
        hourly.reduce((total, value) => total + value, 0),
    )
    let running = initial
    const cumulative = hourly.map((value) => {
      running += value
      return running
    })
    return {
      color: ['#0f5fff', '#88b4ff'],
      tooltip: {
        trigger: 'axis',
        backgroundColor: '#101828',
        borderWidth: 0,
        textStyle: { color: '#fff', fontFamily: 'Inter Variable' }
      },
      legend: {
        left: 10,
        top: 6,
        itemWidth: 12,
        textStyle: { color: '#667085', fontSize: 11 }
      },
      grid: { left: 46, right: 56, top: 52, bottom: 36 },
      xAxis: {
        type: 'category',
        data: rows.map((row) => formatDate(row.hour, false)),
        axisLine: { lineStyle: { color: '#d8dee9' } },
        axisTick: { show: false },
        axisLabel: { color: '#667085', fontSize: 10, interval: 1 }
      },
      yAxis: [
        {
          type: 'value',
          name: 'Published',
          nameTextStyle: { color: '#667085', fontSize: 10 },
          splitLine: { lineStyle: { color: '#edf0f5' } },
          axisLabel: { color: '#667085', fontSize: 10 }
        },
        {
          type: 'value',
          name: 'Active knowledge',
          nameTextStyle: { color: '#667085', fontSize: 10 },
          splitLine: { show: false },
          axisLabel: {
            color: '#667085',
            fontSize: 10,
            formatter: (value: number) => compactNumber(value)
          }
        }
      ],
      series: [
        {
          name: 'Published',
          type: 'bar',
          data: hourly,
          barMaxWidth: 16,
          itemStyle: {
            color: '#0f5fff',
            borderRadius: [3, 3, 0, 0]
          },
          emphasis: { itemStyle: { color: '#0047d7' } }
        },
        {
          name: 'Active knowledge',
          type: 'line',
          yAxisIndex: 1,
          data: cumulative,
          smooth: 0.28,
          showSymbol: false,
          lineStyle: { color: '#83adfb', width: 2 },
          areaStyle: { color: 'rgba(131, 173, 251, .12)' }
        }
      ]
    }
  }, [overview])
}

function useActivityOption(overview: Overview) {
  return useMemo(() => ({
    tooltip: { trigger: 'axis' },
    grid: { left: 42, right: 12, top: 22, bottom: 32 },
    xAxis: {
      type: 'category',
      data: overview.activity_30d.map((row) =>
        new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' })
          .format(new Date(row.day))),
      axisTick: { show: false },
      axisLine: { lineStyle: { color: '#d8dee9' } },
      axisLabel: { color: '#667085', fontSize: 9, interval: 5 }
    },
    yAxis: {
      type: 'value',
      splitLine: { lineStyle: { color: '#edf0f5' } },
      axisLabel: { color: '#667085', fontSize: 9 }
    },
    series: [
      {
        name: 'Published',
        type: 'bar',
        data: overview.activity_30d.map((row) => numberOf(row.published)),
        itemStyle: { color: '#22a06b', borderRadius: [2, 2, 0, 0] },
        barMaxWidth: 9
      },
      {
        name: 'Revisions created',
        type: 'line',
        data: overview.activity_30d.map((row) => numberOf(row.revisions_created)),
        smooth: 0.24,
        symbolSize: 4,
        lineStyle: { color: '#0f5fff', width: 2 },
        itemStyle: { color: '#0f5fff' }
      }
    ]
  }), [overview])
}

function useTokenOption(overview: Overview) {
  return useMemo(() => ({
    tooltip: { trigger: 'axis' },
    grid: { left: 40, right: 10, top: 14, bottom: 30 },
    xAxis: {
      type: 'category',
      data: overview.activity_30d.map((row) =>
        new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' })
          .format(new Date(row.day))),
      axisLine: { lineStyle: { color: '#d8dee9' } },
      axisTick: { show: false },
      axisLabel: { color: '#667085', fontSize: 9, interval: 6 }
    },
    yAxis: {
      type: 'value',
      splitLine: { lineStyle: { color: '#edf0f5' } },
      axisLabel: {
        color: '#667085',
        fontSize: 9,
        formatter: (value: number) => compactNumber(value)
      }
    },
    series: [{
      type: 'line',
      data: overview.activity_30d.map((row) => {
        const published = numberOf(row.published)
        return published ? Math.round(numberOf(row.tokens) / published) : 0
      }),
      smooth: 0.3,
      showSymbol: false,
      lineStyle: { color: '#0f5fff', width: 2 },
      areaStyle: { color: 'rgba(15,95,255,.08)' }
    }]
  }), [overview])
}

const RECORD_PIPELINE_STAGES: Record<string, {
  label: string
  icon: LucideIcon
  help: string
}> = {
  verify: {
    label: 'Verify',
    icon: ShieldCheck,
    help: 'Records waiting for the independent standard verification pass.'
  },
  deep_low: {
    label: 'Deep Low',
    icon: Bot,
    help: 'Unresolved records receiving a low-reasoning Luna review.'
  },
  deep_medium: {
    label: 'Deep Medium',
    icon: Bot,
    help: 'Records escalated to an independent medium-reasoning Luna review.'
  },
  ready: {
    label: 'Ready',
    icon: FileCheck2,
    help: 'Verified records ready for deterministic publication.'
  },
  publish: {
    label: 'Published',
    icon: Tag,
    help: 'Revisions actually added to active knowledge.'
  }
}

export function PipelineRail({ overview }: { overview: Overview }) {
  const sourceBottleneck = [...overview.source_intake]
    .filter((stage) =>
      numberOf(stage.waiting) > 0 && stage.oldest_waiting_at
    )
    .sort((left, right) =>
      new Date(left.oldest_waiting_at ?? 0).getTime() -
      new Date(right.oldest_waiting_at ?? 0).getTime()
    )[0]?.stage
  const recordBottleneck = [...overview.record_pipeline]
    .filter((stage) =>
      numberOf(stage.waiting) > 0 && stage.oldest_waiting_at
    )
    .sort((left, right) =>
      new Date(left.oldest_waiting_at ?? 0).getTime() -
      new Date(right.oldest_waiting_at ?? 0).getTime()
    )[0]?.stage
  return (
    <>
      <Panel
        title="Source intake"
        icon={Network}
        help="Documents move from discovery to prepared fragments. Each stage keeps its natural unit, shown directly on the card."
        className="pipeline-rail-panel"
        action={sourceBottleneck ? <Status tone="warning">Bottleneck · {titleCase(sourceBottleneck)}</Status> : null}
      >
        <div className="pipeline-rail pipeline-rail--five">
          {overview.source_intake.map((stage, index) => {
            const metadata = PIPELINE_STAGES[stage.stage] ?? {
              label: titleCase(stage.stage),
              icon: Layers3,
              waitingHelp: `${stage.unit} waiting`
            }
            return (
              <SourceStageCard
                key={stage.stage}
                stage={stage}
                index={index}
                metadata={metadata}
                bottleneck={stage.stage === sourceBottleneck}
              />
            )
          })}
        </div>
      </Panel>
      <Panel
        title="Knowledge records"
        icon={ShieldCheck}
        help="Every value in this flow counts records. Published is the real number of revisions added to active knowledge, never the number of agent runs or batches."
        className="pipeline-rail-panel"
        action={recordBottleneck ? <Status tone="warning">Bottleneck · {titleCase(recordBottleneck)}</Status> : null}
      >
        <div className="pipeline-rail pipeline-rail--five">
          {overview.record_pipeline.map((stage, index) => (
            <RecordStageCard
              key={stage.stage}
              stage={stage}
              index={index}
              bottleneck={stage.stage === recordBottleneck}
            />
          ))}
        </div>
      </Panel>
    </>
  )
}

function SourceStageCard({
  stage,
  index,
  metadata,
  bottleneck
}: {
  stage: Overview['source_intake'][number]
  index: number
  metadata: (typeof PIPELINE_STAGES)[string]
  bottleneck: boolean
}) {
  const Icon = metadata?.icon ?? Layers3
  const inFlight = numberOf(stage.in_flight)
  const runners = [
    ...stage.active_executor_ids,
    ...(numberOf(stage.active_worker_count) > 0
      ? [`${stage.active_worker_count} mechanical`]
      : [])
  ]
  return (
    <article className={`pipeline-stage ${inFlight ? 'is-running' : ''} ${bottleneck ? 'is-bottleneck' : ''}`}>
      <div className="pipeline-stage__top">
        <span>{index + 1}</span>
        <IconTooltip icon={Icon} label={`${metadata?.label ?? stage.stage} stage`}>
          {metadata?.waitingHelp}. Output shows newly created {stage.unit}
          during the rolling last 24 hours. {runners.length
            ? `Active: ${runners.join(', ')}.`
            : 'No active runner.'}
        </IconTooltip>
        <strong>{metadata?.label ?? titleCase(stage.stage)}</strong>
      </div>
      <dl>
        <div><dt>Waiting</dt><dd>{formatNumber(stage.waiting, 0)}</dd></div>
        <div><dt>In flight</dt><dd>{formatNumber(stage.in_flight, 0)}</dd></div>
        <div><dt>Output</dt><dd>{formatNumber(stage.output_24h, 0)}</dd></div>
        <div><dt>Failed</dt><dd>{formatNumber(stage.failed_24h, 0)}</dd></div>
      </dl>
    </article>
  )
}

function RecordStageCard({
  stage,
  index,
  bottleneck
}: {
  stage: Overview['record_pipeline'][number]
  index: number
  bottleneck: boolean
}) {
  const metadata = RECORD_PIPELINE_STAGES[stage.stage]!
  const Icon = metadata.icon
  const inFlight = numberOf(stage.in_flight)
  return (
    <article className={`pipeline-stage ${inFlight ? 'is-running' : ''} ${bottleneck ? 'is-bottleneck' : ''}`}>
      <div className="pipeline-stage__top">
        <span>{index + 1}</span>
        <IconTooltip icon={Icon} label={`${metadata.label} stage`}>
          {metadata.help} Processed, passed, escalated and rejected cover
          the rolling last 24 hours. {stage.active_executor_ids.length
            ? `Active: ${stage.active_executor_ids.join(', ')}.`
            : 'No Luna currently assigned.'}
        </IconTooltip>
        <strong>{metadata.label}</strong>
      </div>
      <dl>
        <div><dt>Waiting</dt><dd>{formatNumber(stage.waiting, 0)}</dd></div>
        <div><dt>In flight</dt><dd>{formatNumber(stage.in_flight, 0)}</dd></div>
        <div><dt>{stage.stage === 'publish' ? 'Published' : 'Passed'}</dt><dd>{formatNumber(stage.passed_24h, 0)}</dd></div>
        <div><dt>{numberOf(stage.escalated_24h) ? 'Escalated' : 'Rejected'}</dt><dd>{formatNumber(numberOf(stage.escalated_24h) || numberOf(stage.rejected_24h), 0)}</dd></div>
      </dl>
    </article>
  )
}

type ExecutorView = {
  name: string
  state: string
  healthy: boolean
  heartbeat: string | null
  instance: string
  stage: string
  task: string | null
  work: string
}

export function executorRows(overview: Overview): ExecutorView[] {
  return overview.executors.map((executor) => ({
    name: executor.executor_id,
    state: executor.state,
    healthy: executor.healthy,
    heartbeat: executor.heartbeat_at,
    instance: executor.instance_id ?? 'No heartbeat record',
    stage: executor.stage ?? '—',
    task: executor.task_id,
    work: `${formatNumber(executor.work_units, 0)} ${executor.work_unit}`
  }))
}

function ExecutorCard(executor: ExecutorView) {
  const active = executor.healthy && executor.state === 'running'
  const statusTone =
    executor.state === 'stale'
      ? 'danger'
      : executor.state === 'paused'
        ? 'warning'
        : active
          ? 'good'
          : 'neutral'
  return (
    <article className={`executor ${active ? 'is-active' : 'is-standby'}`}>
      <header>
        <span>
          <IconTooltip icon={Bot} label={executor.name}>
            An isolated Luna lane with its own heartbeat, lease and ephemeral workspace.
          </IconTooltip>
          {executor.name}
        </span>
        <Status tone={statusTone}>{titleCase(executor.state)}</Status>
      </header>
      <div className="executor__body">
        <div className="heartbeat" aria-label={`${titleCase(executor.state)} executor`}>
          <i /><b />
        </div>
        <dl>
          <div><dt>Stage</dt><dd>{titleCase(executor.stage)}</dd></div>
          <div><dt>State</dt><dd>{titleCase(executor.state)}</dd></div>
          <div><dt>Batch</dt><dd>{executor.work}</dd></div>
          <div><dt>Heartbeat</dt><dd>{formatDate(executor.heartbeat, false)}</dd></div>
          <div>
            <dt>Task</dt>
            <dd title={executor.task ?? undefined}>
              {executor.task ? shortId(executor.task) : '—'}
            </dd>
          </div>
        </dl>
      </div>
    </article>
  )
}

function ActiveSourceCard({
  source,
  loading
}: {
  source: ActiveSourceDetail | undefined
  loading: boolean
}) {
  if (loading) return (
    <Panel title="Active source progress" icon={FileCheck2} help="Current document processing progress from acquisition through publication.">
      <LoadingState />
    </Panel>
  )
  if (!source) return (
    <Panel title="Active source progress" icon={FileCheck2} help="Current document processing progress from acquisition through publication.">
      <EmptyState>No source is active right now.</EmptyState>
    </Panel>
  )
  const total = numberOf(source.source.fragments_total)
  const completed = numberOf(source.source.fragments_completed)
  const candidates = numberOf(source.source.candidates_total)
  const verified = numberOf(source.source.candidates_verified)
  const percent = total ? (completed / total) * 100 : 0
  return (
    <Panel
      title="Active source progress"
      icon={FileCheck2}
      help="The current source, its extracted fragments and how much verified knowledge is ready for package publication."
      action={<Status>{source.source.status}</Status>}
    >
      <div className="active-source-title">
        <strong>{source.source.title}</strong>
        <span>{source.source.vendor_slug} · {source.source.operating_system_slug}</span>
      </div>
      <div className="source-progress">
        <div className="source-progress__ring" style={{ '--value': `${percent * 3.6}deg` } as CSSProperties}>
          <strong>{Math.round(percent)}%</strong>
          <span>overall</span>
        </div>
        <div className="source-progress__rows">
          <ProgressRow label="Fragments" current={completed} total={total} />
          <ProgressRow label="Candidates" current={candidates} total={Math.max(candidates, total)} />
          <ProgressRow label="Verified" current={verified} total={Math.max(candidates, 1)} />
        </div>
      </div>
      <div className="source-meta">
        <span>Document · {titleCase(source.source.document_role)}</span>
        <span>Updated · {formatDate(source.source.updated_at)}</span>
      </div>
    </Panel>
  )
}

function ProgressRow({
  label,
  current,
  total
}: {
  label: string
  current: number
  total: number
}) {
  const percent = total ? (current / total) * 100 : 0
  return (
    <div className="progress-row">
      <span>{label}</span>
      <ProgressBar value={percent} label={`${label} ${Math.round(percent)}%`} />
      <strong>{current.toLocaleString()} / {total.toLocaleString()}</strong>
    </div>
  )
}

function CoverageHeatmap({ rows }: { rows: CoverageTarget[] }) {
  return (
    <Panel
      title="Coverage gaps"
      icon={Pickaxe}
      help="Lowest coverage targets receive higher discovery attention. Colour reflects completeness, not quality."
    >
      {rows.length ? (
        <div className="coverage-heatmap">
          {rows.map((row) => {
            const coverage = numberOf(row.coverage_percent)
            return (
              <div className="coverage-row" key={row.id}>
                <div>
                  <strong>{row.vendor_slug} · {row.operating_system_slug}</strong>
                  <span>{row.model ?? row.product_family ?? titleCase(row.document_role)}</span>
                </div>
                <ProgressBar
                  value={coverage}
                  tone={coverage >= 75 ? 'good' : coverage >= 40 ? 'warning' : 'danger'}
                  label={`${coverage}% coverage`}
                />
                <b>{formatNumber(coverage, 0)}%</b>
              </div>
            )
          })}
        </div>
      ) : <EmptyState>No coverage targets reported.</EmptyState>}
    </Panel>
  )
}

function BreakdownPanel({ overview }: { overview: Overview }) {
  const rows = [
    ...overview.breakdowns.vendor.slice(0, 5).map((row) => ({ ...row, dimension: 'Vendor' })),
    ...overview.breakdowns.risk.slice(0, 4).map((row) => ({ ...row, dimension: 'Risk' }))
  ]
  const max = Math.max(1, ...rows.map((row) => numberOf(row.count)))
  return (
    <Panel
      title="Knowledge distribution"
      icon={Boxes}
      help="Active knowledge grouped by vendor and operational risk. This helps expose over-concentration and dangerous-content volume."
    >
      <div className="breakdown-list">
        {rows.map((row) => (
          <div key={`${row.dimension}-${row.key}`} className="breakdown-row">
            <span><small>{row.dimension}</small>{titleCase(row.key)}</span>
            <i><b style={{ width: `${(numberOf(row.count) / max) * 100}%` }} /></i>
            <strong>{compactNumber(row.count)}</strong>
          </div>
        ))}
      </div>
    </Panel>
  )
}

function RecentFailures({ overview }: { overview: Overview }) {
  const columns: Array<TableColumn<Overview['recent_errors'][number]>> = [
    { key: 'time', label: 'Time', render: (row) => formatDate(row.created_at) },
    { key: 'stage', label: 'Stage', render: (row) => <Status tone="danger">{titleCase(row.stage)}</Status> },
    { key: 'message', label: 'Message', render: (row) => row.message },
    { key: 'task', label: 'Task', render: (row) => <code>{shortId(row.pipeline_task_id)}</code> }
  ]
  return (
    <Panel
      title="Recent failures"
      icon={AlertTriangle}
      help="The latest pipeline failures. A failure can be retried without blocking unrelated fragments or sources."
    >
      <DataTable
        rows={overview.recent_errors}
        columns={columns}
        rowKey={(row) => row.id}
        empty="No pipeline failures were reported."
      />
    </Panel>
  )
}

function RecentActivity({
  pipeline,
  loading
}: {
  pipeline: PipelineDetails | undefined
  loading: boolean
}) {
  if (loading) return (
    <Panel title="Recent pipeline activity" icon={Clock3} help="Newest pipeline milestones and state changes.">
      <LoadingState />
    </Panel>
  )
  const rows = pipeline?.events.slice(0, 8) ?? []
  return (
    <Panel
      title="Recent pipeline activity"
      icon={Clock3}
      help="Newest progress, completion, publication and retry events across the knowledge factory."
    >
      <DataTable
        rows={rows}
        columns={[
          { key: 'time', label: 'Time', render: (row) => formatDate(row.created_at) },
          { key: 'stage', label: 'Stage', render: (row) => <Status tone={toneFor(row.event_type)}>{titleCase(row.stage)}</Status> },
          { key: 'event', label: 'Event', render: (row) => titleCase(row.event_type) },
          { key: 'message', label: 'Details', render: (row) => row.message }
        ]}
        rowKey={(row) => row.id}
        empty="No recent pipeline events."
      />
    </Panel>
  )
}
