import { describe, expect, it } from 'vitest'

import {
  normalizeTaskReasoning,
  pipelineExecutorIds,
  pipelineExecutorPaths,
  pipelineModel,
  pipelineReasoning
} from '../src/cli/pipeline-runtime.js'
import {
  assertArtifactContainsNoSecrets,
  codexExecutorArguments,
  codexExecutorEnvironment,
  sensitiveEnvironmentValues
} from '../src/cli/pipeline-codex-policy.js'

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

  it('starts Luna with local tools disabled and a minimal environment', () => {
    const args = codexExecutorArguments({
      taskType: 'fragment_analysis',
      model: pipelineModel,
      reasoning: pipelineReasoning,
      outputPath: '/tmp/output.json',
      outputSchemaPath: '/tmp/schema.json',
      workingDirectory: '/tmp/lane'
    })
    expect(args).toContain(pipelineModel)
    expect(args).toContain('model_reasoning_effort="low"')
    for (const feature of [
      'shell_tool',
      'unified_exec',
      'apps',
      'browser_use',
      'multi_agent'
    ]) {
      expect(args).toContain(feature)
      expect(args[args.indexOf(feature) - 1]).toBe('--disable')
    }
    const inherited = codexExecutorEnvironment({
      PATH: '/usr/bin',
      HOME: '/tmp/home',
      CODEX_HOME: '/tmp/codex',
      DATABASE_URL: 'postgres://secret',
      ADMIN_TOKEN: 'sensitive-admin-token'
    })
    expect(inherited).toEqual({
      PATH: '/usr/bin',
      HOME: '/tmp/home',
      CODEX_HOME: '/tmp/codex'
    })
  })

  it('allows web search only for bounded research tasks', () => {
    const common = {
      model: pipelineModel,
      reasoning: pipelineReasoning,
      outputPath: '/tmp/output.json',
      outputSchemaPath: '/tmp/schema.json',
      workingDirectory: '/tmp/lane'
    }
    const discovery = codexExecutorArguments({
      ...common,
      taskType: 'source_discovery'
    })
    const analysis = codexExecutorArguments({
      ...common,
      taskType: 'fragment_analysis'
    })
    expect(discovery[discovery.indexOf('standalone_web_search') - 1])
      .toBe('--enable')
    expect(analysis[analysis.indexOf('standalone_web_search') - 1])
      .toBe('--disable')
  })

  it('allows medium reasoning only for automatic deep review without web search', () => {
    const common = {
      model: pipelineModel,
      reasoning: 'medium',
      outputPath: '/tmp/output.json',
      outputSchemaPath: '/tmp/schema.json',
      workingDirectory: '/tmp/lane'
    }
    expect(() => codexExecutorArguments({
      ...common,
      taskType: 'fragment_analysis'
    })).toThrow('PIPELINE_REASONING_POLICY_REJECTED')
    const deepReview = codexExecutorArguments({
      ...common,
      taskType: 'candidate_deep_review'
    })
    expect(deepReview).toContain('model_reasoning_effort="medium"')
    expect(
      deepReview[deepReview.indexOf('standalone_web_search') - 1]
    ).toBe('--disable')
  })

  it('rejects generated artifacts that contain a real secret', () => {
    const environment = {
      CLIDECK_RESEARCHER_TOKEN: 'sentinel-secret-value-12345',
      PATH: '/usr/bin'
    }
    const sensitive = sensitiveEnvironmentValues(environment)
    expect(sensitive).toEqual(['sentinel-secret-value-12345'])
    expect(() =>
      assertArtifactContainsNoSecrets(
        '{"summary":"sentinel-secret-value-12345"}',
        sensitive,
      ),
    ).toThrow('AGENT_ARTIFACT_SECRET_DETECTED')
    expect(() =>
      assertArtifactContainsNoSecrets(
        '{"summary":"No credentials are present."}',
        sensitive,
      ),
    ).not.toThrow()
  })
})

describe('pipeline task reasoning', () => {
  it('preserves medium review and fails unknown values closed to low', () => {
    expect(normalizeTaskReasoning('medium')).toBe('medium')
    expect(normalizeTaskReasoning('low')).toBe('low')
    expect(normalizeTaskReasoning(undefined)).toBe('low')
    expect(normalizeTaskReasoning('high')).toBe('low')
  })
})
