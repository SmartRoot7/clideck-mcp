export const pipelineExecutorIds = [
  'pipeline-executor-01',
  'pipeline-executor-02',
  'pipeline-executor-03',
  'pipeline-executor-04',
  'pipeline-executor-05',
  'pipeline-executor-06',
  'pipeline-executor-07',
  'pipeline-executor-08'
] as const

export type PipelineExecutorId = typeof pipelineExecutorIds[number]
