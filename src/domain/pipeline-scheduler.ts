export const weightedAiStages = [
  'deep_medium',
  'deep_low',
  'verify',
  'analyze'
] as const

export type WeightedAiStage = (typeof weightedAiStages)[number]

type WeightedAiAllocationInput = {
  concurrency: number
  occupied: number
  activeByStage: Record<WeightedAiStage, number>
  queueStage: (stage: WeightedAiStage) => Promise<boolean>
}

export type WeightedAiAllocation = {
  occupied: number
  activeByStage: Record<WeightedAiStage, number>
  queuedStages: WeightedAiStage[]
}

/**
 * Keeps extraction productive while filling every available executor lane.
 * Stage ordering is a priority, never a capacity limit: if useful work exists,
 * no lane is intentionally left idle.
 */
export async function fillWeightedAiCapacity(
  input: WeightedAiAllocationInput,
): Promise<WeightedAiAllocation> {
  const concurrency = Math.max(0, Math.trunc(input.concurrency))
  let occupied = Math.max(0, Math.trunc(input.occupied))
  const activeByStage = { ...input.activeByStage }
  const queuedStages: WeightedAiStage[] = []
  const hasCapacity = () => occupied < concurrency
  const queue = async (stage: WeightedAiStage): Promise<boolean> => {
    if (!hasCapacity()) return false
    if (!(await input.queueStage(stage))) return false
    occupied += 1
    activeByStage[stage] += 1
    queuedStages.push(stage)
    return true
  }

  // Extract is the productive lane and cannot be starved by audit backlog.
  if (activeByStage.analyze === 0 && hasCapacity()) await queue('analyze')

  // Fidelity and repair stay downstream-first without an artificial lane cap.
  for (const stage of ['deep_medium', 'deep_low', 'verify'] as const) {
    while (hasCapacity() && await queue(stage)) {
      // Fill the stage until its queue is exhausted or all executors are busy.
    }
  }

  // Remaining lanes are work-conserving; extraction receives them first.
  while (hasCapacity()) {
    let queued = false
    for (const stage of [
      'analyze', 'deep_medium', 'deep_low', 'verify'
    ] as const) {
      if (await queue(stage)) {
        queued = true
        break
      }
    }
    if (!queued) break
  }

  return { occupied, activeByStage, queuedStages }
}
