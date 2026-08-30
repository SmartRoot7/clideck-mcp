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
  fidelityAndRepairCap?: number
}

export type WeightedAiAllocation = {
  occupied: number
  activeByStage: Record<WeightedAiStage, number>
  queuedStages: WeightedAiStage[]
}

/**
 * Keeps extraction productive while bounding source-fidelity and repair work.
 * Discovery is serialized outside this allocator. Verify represents Fidelity
 * QA during the additive compatibility release.
 */
export async function fillWeightedAiCapacity(
  input: WeightedAiAllocationInput,
): Promise<WeightedAiAllocation> {
  const concurrency = Math.max(0, Math.trunc(input.concurrency))
  let occupied = Math.max(0, Math.trunc(input.occupied))
  const activeByStage = { ...input.activeByStage }
  const queuedStages: WeightedAiStage[] = []
  const cap = Math.max(
    1,
    Math.min(2, Math.trunc(input.fidelityAndRepairCap ?? 2)),
  )
  const restricted = new Set<WeightedAiStage>([
    'deep_medium', 'deep_low', 'verify'
  ])
  const hasCapacity = () => occupied < concurrency
  const restrictedCount = () => [...restricted].reduce(
    (total, stage) => total + activeByStage[stage],
    0,
  )
  const queue = async (stage: WeightedAiStage): Promise<boolean> => {
    if (!hasCapacity()) return false
    if (restricted.has(stage) && restrictedCount() >= cap) return false
    if (!(await input.queueStage(stage))) return false
    occupied += 1
    activeByStage[stage] += 1
    queuedStages.push(stage)
    return true
  }

  // Extract is the productive lane and cannot be starved by audit backlog.
  if (activeByStage.analyze === 0 && hasCapacity()) await queue('analyze')

  // Fidelity/repair stays downstream-first but never occupies more than two.
  for (const stage of ['deep_medium', 'deep_low', 'verify'] as const) {
    while (hasCapacity() && restrictedCount() < cap && await queue(stage)) {
      // Fill the bounded stage until its queue or shared cap is exhausted.
    }
  }

  // Remaining lanes are work-conserving; extraction receives them first.
  while (hasCapacity()) {
    let queued = false
    for (const stage of [
      'analyze', 'deep_medium', 'deep_low', 'verify'
    ] as const) {
      if (restricted.has(stage) && restrictedCount() >= cap) continue
      if (await queue(stage)) {
        queued = true
        break
      }
    }
    if (!queued) break
  }

  return { occupied, activeByStage, queuedStages }
}
