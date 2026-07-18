import { resolve } from 'node:path'

export const pipelineModel = 'gpt-5.6-luna' as const
export const pipelineReasoning = 'low' as const
export const pipelineExecutorIds = [
  'pipeline-executor-01',
  'pipeline-executor-02',
  'pipeline-executor-03',
  'pipeline-executor-04'
] as const

export type PipelineExecutorId = typeof pipelineExecutorIds[number]

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
