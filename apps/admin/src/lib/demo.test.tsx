import { render, screen } from '@testing-library/react'
import {
  QueryClient,
  QueryClientProvider
} from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'

import type { PublicDemoSnapshot } from '@clideck/demo-contracts'

import { AppShell } from '../components/app-shell'
import {
  demoCoverage,
  demoOverview,
  demoPipeline,
  demoQuality
} from './demo'

const now = '2026-07-19T12:00:00.000Z'
const hours = Array.from({ length: 24 }, (_, index) => ({
  hour: new Date(Date.parse(now) - (23 - index) * 3_600_000).toISOString(),
  published: index
}))
const days = Array.from({ length: 30 }, (_, index) => ({
  day: new Date(Date.parse(now) - (29 - index) * 86_400_000).toISOString(),
  published: index,
  queries: index * 2,
  lab_validations: 0
}))

const snapshot = {
  generated_at: now,
  system: {
    status: 'healthy',
    pipeline_enabled: true,
    healthy_workers: 4,
    total_workers: 4,
    configured_luna: 3,
    active_luna: 2,
    active_stage: 'analyze'
  },
  release: {
    sequence: 42,
    published_at: now,
    published_knowledge: 58_904,
    domains: 2,
    published_24h: 17
  },
  published_hourly_24h: hours,
  growth_30d: days,
  operations: {
    ai_model: 'gpt-5.6-luna',
    reasoning_effort: 'low',
    pipeline_updated_at: now,
    sources_total: 100,
    sources_completed: 80,
    fragments_total: 2_000,
    candidates_total: 900,
    failures_24h: 0,
    completed_stages_24h: 120,
    tokens_total: 10_000,
    tokens_today: 1_000,
    tokens_per_revision: 12,
    queued_expert: 0,
    queued_verify: 5,
    queued_analyze: 12,
    queued_discover: 1,
    queued_tasks: 18,
    open_conflicts: 0,
    feedback_24h: 0,
    executors: [{
      id: 'pipeline-executor-01',
      healthy: true,
      heartbeat_at: now,
      state: 'active',
      stage: 'analyze'
    }],
    activity_30d: days.map((day) => ({
      day: day.day,
      published: day.published,
      revisions_created: day.published,
      stages_completed: day.queries,
      tokens: day.queries * 10
    })),
    breakdowns: {
      vendor: [{ key: 'cisco', count: 58_000 }],
      operating_system: [{ key: 'ios-xe', count: 58_000 }],
      risk: [{ key: 'safe_read_only', count: 40_000 }],
      origin: [{ key: 'legacy', count: 56_747 }]
    }
  },
  pipeline_funnel: [
    'discover', 'acquire', 'convert', 'chunk', 'analyze', 'verify', 'publish'
  ].map((stage) => ({
    stage,
    queued: stage === 'analyze' ? 12 : 0,
    running: stage === 'analyze' ? 2 : 0,
    completed: 20,
    failed: 0
  })),
  coverage: {
    domains: [{
      id: 'network',
      name: 'Network Knowledge',
      records: 58_904,
      record_types: 6
    }],
    vendors: [{ key: 'cisco', count: 58_000 }],
    operating_systems: [{ key: 'ios-xe', count: 58_000 }],
    risks: [{ key: 'safe_read_only', count: 40_000 }],
    targets: [{
      vendor_slug: 'cisco',
      product_family: 'catalyst',
      model: 'catalyst-9300',
      operating_system_slug: 'ios-xe',
      version_branch: '17.x',
      document_role: 'commands',
      status: 'active',
      priority: 100,
      coverage_percent: 80,
      next_check_at: now,
      last_discovered_at: now,
      last_completed_at: now,
      source_count: 10,
      completed_sources: 8,
      failed_sources: 0,
      created_at: now,
      updated_at: now
    }]
  },
  pipeline_tasks: [{
    task_type: 'fragment_analysis',
    stage: 'analyze',
    status: 'running',
    priority: 20,
    lease_until: now,
    heartbeat_at: now,
    attempts: 1,
    created_at: now,
    updated_at: now,
    completed_at: null
  }],
  efficiency: {
    tokens_24h: 1_000,
    tokens_per_published_revision: 12,
    no_ai_answer_rate: 0.99
  },
  evaluation: {
    suite: 'public-eval',
    cases: 250,
    passed: 250,
    failed: 0,
    dangerous_false_safe: 0,
    p95_ms: 50,
    executed_at: now
  },
  quality: {
    summary: {
      revisions: 58_904,
      avg_confidence: 0.96,
      avg_quality: 0.95,
      dangerous_revisions: 100,
      dangerous_below_threshold: 0,
      regular_below_threshold: 0
    },
    eval_runs: [],
    operation_latency_30d: [],
    conflicts: []
  },
  samples: []
} satisfies PublicDemoSnapshot

describe('public read-only mode', () => {
  it('adapts the sanitized snapshot to the exact admin page contracts', () => {
    expect(demoOverview(snapshot).published_revisions).toBe(58_904)
    expect(demoPipeline(snapshot).tasks[0]?.stage).toBe('analyze')
    expect(demoCoverage(snapshot)[0]?.vendor_slug).toBe('cisco')
    expect(demoQuality(snapshot).summary.dangerous_below_threshold).toBe(0)
  })

  it('uses the real admin shell without exposing mutation or provenance controls', () => {
    const queryClient = new QueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <AppShell
          section="overview"
          overview={demoOverview(snapshot)}
          refreshing={false}
          onNavigate={() => undefined}
          onRefresh={() => undefined}
          publicMode
        >
          <div>Real admin page content</div>
        </AppShell>
      </QueryClientProvider>,
    )

    expect(screen.getByText('Real admin page content')).toBeInTheDocument()
    expect(screen.getByText('Live · public read-only')).toBeInTheDocument()
    expect(screen.getByText('Pipeline')).toBeInTheDocument()
    expect(screen.getByText('Coverage')).toBeInTheDocument()
    expect(screen.getByText('Quality')).toBeInTheDocument()
    expect(screen.queryByText('Pause all Luna')).not.toBeInTheDocument()
    expect(screen.queryByText('Provenance')).not.toBeInTheDocument()
    expect(screen.queryByText('Sources')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Configured Luna executors'))
      .not.toBeInTheDocument()
  })
})
