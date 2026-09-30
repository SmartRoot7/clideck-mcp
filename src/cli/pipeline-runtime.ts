import { resolve } from 'node:path'
import { executionReasoningSchema, type ExecutionReasoning } from '@clideck/admin-contracts'

import {
  pipelineExecutorIds,
  type PipelineExecutorId
} from '../domain/pipeline-runtime.js'

export { pipelineExecutorIds, type PipelineExecutorId }

export const pipelineModel = 'gpt-5.6-luna' as const
export const pipelineFallbackModel = 'gpt-5.6-terra' as const
export type PipelineModel =
  | typeof pipelineModel
  | typeof pipelineFallbackModel
export const pipelineReasoning = 'low' as const
export function normalizeTaskReasoning(
  value: unknown,
): ExecutionReasoning {
  return executionReasoningSchema.parse(value ?? 'low')
}

export function pipelineExecutorPaths(
  projectRoot: string,
  executorId: PipelineExecutorId,
) {
  return {
    secretDirectory: resolve(
      projectRoot,
      '.secrets',
      'pipeline',
      executorId,
    ),
    tempDirectory: resolve(projectRoot, 'tmp', 'pipeline', executorId)
  }
}
