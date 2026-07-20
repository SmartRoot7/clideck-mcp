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
 * Keeps the pipeline work-conserving while favouring work nearest publication.
 *
 * With four available lanes, at most three distinct background stages receive
 * a guaranteed lane. Remaining capacity is assigned downstream-first. This
 * produces a 2/1/1 split when three stages have work, a 3/1 split when two
 * stages have work, and uses every lane when only one stage has a backlog.
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
    if (!hasCapacity() || !(await input.queueStage(stage))) return false
    occupied += 1
    activeByStage[stage] += 1
    queuedStages.push(stage)
    return true
  }

  // Preserve enough diversity to keep records flowing toward publication.
  // Analyze intentionally sits last: it receives a lane only after the more
  // mature record stages, unless those stages have no work.
  const diversityTarget = Math.min(3, concurrency)
  let activeStageCount = weightedAiStages.filter(
    (stage) => activeByStage[stage] > 0,
  ).length
  for (const stage of weightedAiStages) {
    if (!hasCapacity() || activeStageCount >= diversityTarget) break
    if (activeByStage[stage] > 0) continue
    if (await queue(stage)) activeStageCount += 1
  }

  // Give every remaining lane to the highest stage that can reserve work.
  while (hasCapacity()) {
    let queued = false
    for (const stage of weightedAiStages) {
      if (await queue(stage)) {
        queued = true
        break
      }
    }
    if (!queued) break
  }

  return { occupied, activeByStage, queuedStages }
}
