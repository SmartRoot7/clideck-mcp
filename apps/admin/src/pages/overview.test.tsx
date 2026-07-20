import '@testing-library/jest-dom/vitest'

import type { Overview } from '@clideck/admin-contracts'
import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import {
  PIPELINE_STAGES,
  PipelineRail,
  executorRows
} from './overview'

const now = new Date('2026-07-19T21:00:00.000Z').toISOString()

function overviewFixture(): Overview {
  return {
    snapshot_at: now,
    prepared_sources: 8,
    prepared_source_target: 8,
    record_outcomes_24h: {
      rejected: 12,
      conflict: 3,
      quarantine: 4,
      exception: 1
    },
    pipeline_funnel: Object.entries(PIPELINE_STAGES).map(
      ([stage, metadata], index) => ({
        stage,
        count: index + 1,
        queued: 0,
        running: stage === 'deep_review' ? 1 : 0,
        completed: 10 + index,
        failed: 0,
        cancelled: 0,
        skipped: 0,
        waiting: stage === 'deep_review' ? 5_149 : index,
        waiting_unit:
          stage === 'deep_review' ? 'candidates' : metadata.label,
        oldest_waiting_at: index > 0 ? now : null,
        active_executor_ids:
          stage === 'deep_review' ? ['pipeline-executor-02'] : [],
        active_worker_count: 0
      }),
    ),
    source_intake: [
      'discover',
      'acquire',
      'convert',
      'chunk',
      'analyze'
    ].map((stage, index) => ({
      stage,
      unit: stage === 'analyze' ? 'fragments' : 'sources',
      waiting: index,
      in_flight: stage === 'analyze' ? 2 : 0,
      processed_24h: 20 + index,
      output_24h: 10 + index,
      failed_24h: 0,
      oldest_waiting_at: index ? now : null,
      active_executor_ids:
        stage === 'analyze' ? ['pipeline-executor-01'] : [],
      active_worker_count: 0
    })),
    record_pipeline: [
      'verify',
      'deep_low',
      'deep_medium',
      'ready',
      'publish'
    ].map((stage, index) => ({
      stage,
      unit: 'records',
      waiting: stage === 'deep_medium' ? 5_149 : index,
      in_flight: stage === 'deep_medium' ? 20 : 0,
      processed_24h: 40 + index,
      passed_24h: 30 + index,
      escalated_24h: stage === 'deep_low' ? 5 : 0,
      rejected_24h: 1,
      oldest_waiting_at: index ? now : null,
      active_executor_ids:
        stage === 'deep_medium'
          ? ['pipeline-executor-02', 'pipeline-executor-03']
          : []
    })) as Overview['record_pipeline'],
    executors: [
      {
        executor_id: 'pipeline-executor-01',
        instance_id: 'pipeline-executor-01:instance',
        state: 'standby',
        healthy: true,
        stage: null,
        task_id: null,
        task_type: null,
        work_units: 0,
        work_unit: 'tasks',
        heartbeat_at: now,
        lease_until: null
      },
      {
        executor_id: 'pipeline-executor-02',
        instance_id: 'pipeline-executor-02:instance',
        state: 'running',
        healthy: true,
        stage: 'deep_review',
        task_id: '00000000-0000-4000-8000-000000000002',
        task_type: 'candidate_deep_review',
        work_units: 20,
        work_unit: 'records',
        heartbeat_at: now,
        lease_until: now
      }
    ],
    processes: [{
      worker_name: 'pipeline-executor-01',
      instance_id: 'stale-heartbeat',
      heartbeat_at: now,
      metadata: { status: 'running', stage: 'analyze' },
      healthy: true
    }]
  } as unknown as Overview
}

describe('overview pipeline snapshot', () => {
  it('renders source intake and record flow using result units', () => {
    render(<PipelineRail overview={overviewFixture()} />)

    expect(screen.getByText('Deep Medium')).toBeInTheDocument()
    expect(screen.getAllByText('Published')).toHaveLength(2)
    expect(screen.getAllByText('Waiting')).toHaveLength(10)
    expect(screen.getAllByText('In flight')).toHaveLength(10)
    expect(screen.getAllByText('Output')).toHaveLength(5)
    expect(screen.getAllByText('Failed')).toHaveLength(6)
    expect(screen.queryByText('Queued')).not.toBeInTheDocument()
    expect(screen.queryByText('Done')).not.toBeInTheDocument()
    expect(screen.getByText('5,149')).toBeInTheDocument()
    expect(screen.getByText('Quarantine')).toBeInTheDocument()
    expect(screen.getByText('Exception')).toBeInTheDocument()
    const downloadedCard = screen
      .getByLabelText('Downloaded stage help')
      .closest('article')
    expect(downloadedCard).not.toBeNull()
    expect(within(downloadedCard!).getByText('Buffered')).toBeInTheDocument()
    expect(within(downloadedCard!).getByText('Target')).toBeInTheDocument()
    expect(
      within(downloadedCard!).getByText('Downloaded / 24h'),
    ).toBeInTheDocument()
    expect(within(downloadedCard!).getAllByText('8')).toHaveLength(2)
    const analyzeRunner = screen.getByLabelText('1 active runner on Analyze')
    const deepRunner = screen.getByLabelText('2 active runners on Deep Medium')
    expect(analyzeRunner).toBeInTheDocument()
    expect(deepRunner).toBeInTheDocument()
    expect(analyzeRunner.closest('article')).toHaveClass('is-running')
    expect(deepRunner.closest('article')).toHaveClass('is-running')
  })

  it('derives executor stages from the authoritative runtime snapshot', () => {
    const rows = executorRows(overviewFixture())

    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({
      name: 'pipeline-executor-01',
      state: 'standby',
      stage: '—'
    })
    expect(rows[1]).toMatchObject({
      name: 'pipeline-executor-02',
      state: 'running',
      stage: 'deep_review'
    })
  })
})
