import '@testing-library/jest-dom/vitest'

import type { Overview } from '@clideck/admin-contracts'
import { render, screen } from '@testing-library/react'
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
    executors: [
      {
        executor_id: 'pipeline-executor-01',
        instance_id: 'pipeline-executor-01:instance',
        state: 'standby',
        healthy: true,
        stage: null,
        task_id: null,
        task_type: null,
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
  it('renders all eight stages with concise metric labels', () => {
    render(<PipelineRail overview={overviewFixture()} />)

    expect(screen.getByText('Deep Review')).toBeInTheDocument()
    expect(screen.getByText('Publish')).toBeInTheDocument()
    expect(screen.getAllByText('Waiting')).toHaveLength(8)
    expect(screen.getAllByText('Running')).toHaveLength(8)
    expect(screen.getAllByText('Done')).toHaveLength(8)
    expect(screen.getAllByText('Failed')).toHaveLength(8)
    expect(screen.queryByText('Queued')).not.toBeInTheDocument()
    expect(screen.queryByText('Completed')).not.toBeInTheDocument()
    expect(screen.getByText('5,149')).toBeInTheDocument()
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
