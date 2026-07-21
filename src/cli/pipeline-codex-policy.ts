import type { PipelineTaskRow } from '../domain/pipeline.js'

type PipelineTaskType = PipelineTaskRow['task_type']

const disabledCodexFeatures = [
  'apps',
  'auth_elicitation',
  'browser_use',
  'browser_use_external',
  'browser_use_full_cdp_access',
  'code_mode',
  'code_mode_host',
  'computer_use',
  'enable_mcp_apps',
  'goals',
  'hooks',
  'image_generation',
  'in_app_browser',
  'multi_agent',
  'plugins',
  'remote_plugin',
  'request_permissions_tool',
  'shell_snapshot',
  'shell_tool',
  'skill_mcp_dependency_install',
  'tool_call_mcp_elicitation',
  'tool_suggest',
  'unified_exec',
  'workspace_dependencies'
] as const

const webResearchTasks = new Set<PipelineTaskType>([
  'expert_research',
  'source_discovery',
  'source_refresh'
])

export function assertPipelineAiPolicy(input: {
  taskType: PipelineTaskType
  model: string
  reasoning: string
}): void {
  if (input.model !== 'gpt-5.6-luna') {
    throw new Error('PIPELINE_LUNA_MODEL_REQUIRED')
  }
  if (
    input.reasoning !== 'low' &&
    !(
      (
        input.taskType === 'candidate_deep_review' &&
        input.reasoning === 'medium'
      ) || (
        input.taskType === 'demand_diagnosis' &&
        input.reasoning === 'medium'
      )
    )
  ) {
    throw new Error('PIPELINE_REASONING_POLICY_REJECTED')
  }
}

export function codexExecutorArguments(input: {
  taskType: PipelineTaskType
  model: string
  reasoning: string
  outputPath: string
  outputSchemaPath: string
  workingDirectory: string
}): string[] {
  assertPipelineAiPolicy(input)
  return [
    'exec',
    '--ephemeral',
    '--ignore-user-config',
    '--ignore-rules',
    '--json',
    '--color',
    'never',
    '--sandbox',
    'read-only',
    ...disabledCodexFeatures.flatMap((feature) => [
      '--disable',
      feature
    ]),
    ...(webResearchTasks.has(input.taskType)
      ? ['--enable', 'standalone_web_search']
      : ['--disable', 'standalone_web_search']),
    '-m',
    input.model,
    '-c',
    `model_reasoning_effort="${input.reasoning}"`,
    '-c',
    'approval_policy="never"',
    '-c',
    'shell_environment_policy.inherit="none"',
    '-c',
    'mcp_servers={}',
    '-c',
    'tool_output_token_limit=4000',
    '-o',
    input.outputPath,
    '--output-schema',
    input.outputSchemaPath,
    '-C',
    input.workingDirectory,
    '-'
  ]
}

export function codexExecutorEnvironment(
  source: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = {}
  for (const key of [
    'PATH',
    'HOME',
    'CODEX_HOME',
    'TMPDIR',
    'LANG',
    'LC_ALL',
    'SSL_CERT_FILE',
    'SSL_CERT_DIR'
  ]) {
    const value = source[key]
    if (value) result[key] = value
  }
  return result
}

export function sensitiveEnvironmentValues(
  source: NodeJS.ProcessEnv,
): string[] {
  const sensitiveName =
    /(?:^|_)(?:api_?key|auth|credential|pass(?:word)?|private_?key|secret|token)(?:_|$)/i
  return Object.entries(source)
    .filter(([name, value]) =>
      sensitiveName.test(name) && typeof value === 'string' && value.length >= 8
    )
    .map(([, value]) => value as string)
}

export function assertArtifactContainsNoSecrets(
  serializedArtifact: string,
  sensitiveValues: string[],
): void {
  if (
    /-----BEGIN [^-]*PRIVATE KEY-----/i.test(serializedArtifact) ||
    /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/i.test(serializedArtifact) ||
    /\b(?:gh[opsu]_[A-Za-z0-9]{20,}|sk-(?:proj-)?[A-Za-z0-9_-]{20,})\b/.test(
      serializedArtifact,
    ) ||
    sensitiveValues.some((secret) => serializedArtifact.includes(secret))
  ) {
    throw new Error('AGENT_ARTIFACT_SECRET_DETECTED')
  }
}
