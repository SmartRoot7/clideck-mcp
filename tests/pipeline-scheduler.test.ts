import { describe, expect, it } from 'vitest'

import {
  fillWeightedAiCapacity,
  type WeightedAiStage
} from '../src/domain/pipeline-scheduler.js'

const emptyCounts = (): Record<WeightedAiStage, number> => ({
  deep_medium: 0,
  deep_low: 0,
  verify: 0,
  analyze: 0
})

async function allocate(
  available: Partial<Record<WeightedAiStage, number>>,
  options: {
    concurrency?: number
    occupied?: number
    activeByStage?: Partial<Record<WeightedAiStage, number>>
  } = {},
) {
  const remaining = { ...available }
  return fillWeightedAiCapacity({
    concurrency: options.concurrency ?? 4,
    occupied: options.occupied ?? 0,
    activeByStage: {
      ...emptyCounts(),
      ...options.activeByStage
    },
    queueStage: async (stage) => {
      if ((remaining[stage] ?? 0) <= 0) return false
      remaining[stage] = (remaining[stage] ?? 0) - 1
      return true
    }
  })
}

describe('weighted Luna scheduling', () => {
  it('favours Deep Low while preserving Verify and Analyze lanes', async () => {
    const result = await allocate({
      deep_low: 10,
      verify: 10,
      analyze: 10
    })

    expect(result.activeByStage).toEqual({
      deep_medium: 0,
      deep_low: 2,
      verify: 1,
      analyze: 1
    })
  })

  it('gives Deep Medium the larger share when three stages wait', async () => {
    const result = await allocate({
      deep_medium: 10,
      deep_low: 10,
      verify: 10,
      analyze: 10
    })

    expect(result.activeByStage).toEqual({
      deep_medium: 2,
      deep_low: 1,
      verify: 1,
      analyze: 0
    })
  })

  it('uses a three-to-one split when only two stages wait', async () => {
    const result = await allocate({
      deep_medium: 10,
      deep_low: 10
    })

    expect(result.activeByStage).toEqual({
      deep_medium: 3,
      deep_low: 1,
      verify: 0,
      analyze: 0
    })
  })

  it('uses every lane when only one stage has work', async () => {
    const result = await allocate({ deep_low: 10 })

    expect(result.activeByStage.deep_low).toBe(4)
    expect(result.occupied).toBe(4)
  })

  it('converges from an old Analyze-heavy allocation without preemption', async () => {
    const result = await allocate(
      { deep_low: 10, verify: 10, analyze: 10 },
      {
        occupied: 3,
        activeByStage: { analyze: 3 }
      },
    )

    expect(result.queuedStages).toEqual(['deep_low'])
    expect(result.activeByStage).toEqual({
      deep_medium: 0,
      deep_low: 1,
      verify: 0,
      analyze: 3
    })
  })
})
