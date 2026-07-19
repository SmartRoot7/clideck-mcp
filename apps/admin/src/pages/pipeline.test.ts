import type { Overview } from '@clideck/admin-contracts'
import { describe, expect, it } from 'vitest'

import { pipelineRecordBacklog } from './pipeline'

describe('pipeline record backlog', () => {
  it('counts record review stages without double-counting ready publications', () => {
    const stages = [
      { stage: 'verify', waiting: 4 },
      { stage: 'deep_low', waiting: 30 },
      { stage: 'deep_medium', waiting: 6 },
      { stage: 'ready', waiting: 50 },
      { stage: 'publish', waiting: 50 }
    ] as Overview['record_pipeline']

    expect(pipelineRecordBacklog(stages)).toBe(40)
  })
})
