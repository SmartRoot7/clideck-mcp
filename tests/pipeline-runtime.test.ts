import {
  pipelineExecutorIds,
  pipelineExecutorPaths,
  pipelineModel,
  pipelineReasoning
} from '../src/cli/pipeline-runtime.js'

describe('parallel Luna runtime', () => {
  it('uses four isolated executor lanes with the economical model', () => {
    expect(pipelineModel).toBe('gpt-5.6-luna')
    expect(pipelineReasoning).toBe('low')
    expect(pipelineExecutorIds).toEqual([
      'pipeline-executor-01',
      'pipeline-executor-02',
      'pipeline-executor-03',
      'pipeline-executor-04'
    ])

    const workspaces = pipelineExecutorIds.map((executorId) =>
      pipelineExecutorPaths('/srv/clideck-mcp', executorId),
    )
    expect(new Set(
      workspaces.map((workspace) => workspace.secretDirectory),
    ).size).toBe(4)
    expect(new Set(
      workspaces.map((workspace) => workspace.tempDirectory),
    ).size).toBe(4)
  })
})
