import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import {
  executionCatalogModelSchema, executionProtocolVersion, executionReasoningSchema,
  type ExecutionCatalogReport
} from '@clideck/admin-contracts'
import { codexExecutorEnvironment } from './pipeline-codex-policy.js'

const execute = promisify(execFile)

export async function discoverCodexModels(binary: string, source: NodeJS.ProcessEnv): Promise<ExecutionCatalogReport> {
  const environment = codexExecutorEnvironment(source)
  const base: ExecutionCatalogReport = {
    protocol_version: executionProtocolVersion, cli_version: 'unknown', models: [],
    error: null, supports_structured_output: false, supports_web_research: false
  }
  try {
    const [version, help, features] = await Promise.all([
      execute(binary, ['--version'], { env: environment, timeout: 10_000, maxBuffer: 64 * 1024 }),
      execute(binary, ['exec', '--help'], { env: environment, timeout: 10_000, maxBuffer: 256 * 1024 }),
      execute(binary, ['features', 'list'], { env: environment, timeout: 10_000, maxBuffer: 256 * 1024 })
    ])
    base.cli_version = version.stdout.trim().slice(0, 100)
    base.supports_structured_output = help.stdout.includes('--output-schema') &&
      help.stdout.includes('--ignore-user-config') && help.stdout.includes('--ignore-rules')
    base.supports_web_research = ['standalone_web_search', 'code_mode', 'code_mode_host']
      .every((feature) => features.stdout.includes(feature))
    if (!base.supports_structured_output || !base.supports_web_research) {
      return { ...base, error: 'CODEX_INCOMPATIBLE' }
    }
  } catch (error) {
    return { ...base, error: (error as NodeJS.ErrnoException).code === 'ENOENT'
      ? 'CODEX_BINARY_UNAVAILABLE' : 'CODEX_INCOMPATIBLE' }
  }
  const child = spawn(binary, ['app-server', '-c', 'model_provider="openai"'], {
    env: environment, stdio: ['pipe', 'pipe', 'ignore']
  })
  try {
    const models = await new Promise<ExecutionCatalogReport['models']>((resolve, reject) => {
      let buffer = ''
      let receivedBytes = 0
      let requestId = 1
      const collected: ExecutionCatalogReport['models'] = []
      const timer = setTimeout(() => reject(new Error('CODEX_CATALOG_TIMEOUT')), 20_000)
      const send = (method: string, params?: unknown, id?: number) => child.stdin.write(
        `${JSON.stringify({ method, ...(params === undefined ? {} : { params }), ...(id === undefined ? {} : { id }) })}\n`,
      )
      const finish = (error?: Error) => {
        clearTimeout(timer)
        if (error) reject(error); else resolve(collected)
      }
      child.once('error', finish)
      child.once('exit', () => finish(new Error('CODEX_CATALOG_EXITED')))
      child.stdout.on('data', (chunk: Buffer) => {
        receivedBytes += chunk.length
        if (receivedBytes > 1024 * 1024) return finish(new Error('CODEX_CATALOG_TOO_LARGE'))
        buffer += chunk.toString('utf8')
        let end: number
        while ((end = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, end); buffer = buffer.slice(end + 1)
          try {
            const rpc = JSON.parse(line) as { id?: number; error?: unknown; result?: { data?: unknown[]; nextCursor?: string | null } }
            if (rpc.id !== requestId) continue
            if (rpc.error) return finish(new Error('CODEX_CATALOG_REJECTED'))
            if (requestId === 1) {
              send('initialized')
              send('model/list', { limit: 20, includeHidden: false }, ++requestId)
              continue
            }
            for (const entry of rpc.result?.data ?? []) {
              const model = entry as Record<string, unknown>
              if (model['hidden']) continue
              const efforts = (model['supportedReasoningEfforts'] as Array<{ reasoningEffort: unknown }> ?? [])
                .flatMap((effort) => {
                  const parsed = executionReasoningSchema.safeParse(effort.reasoningEffort)
                  return parsed.success ? [parsed.data] : []
                })
              if (!efforts.length) continue
              const defaultEffort = executionReasoningSchema.safeParse(model['defaultReasoningEffort'])
              collected.push(executionCatalogModelSchema.parse({
                model: model['model'], display_name: model['displayName'],
                description: typeof model['description'] === 'string' ? model['description'].slice(0, 1000) : '',
                reasoning_efforts: efforts,
                default_reasoning_effort: defaultEffort.success && efforts.includes(defaultEffort.data)
                  ? defaultEffort.data : efforts[0]
              }))
            }
            if (collected.length > 100) return finish(new Error('CODEX_CATALOG_TOO_LARGE'))
            if (rpc.result?.nextCursor) send('model/list', { limit: 20, includeHidden: false, cursor: rpc.result.nextCursor }, ++requestId)
            else finish()
          } catch { finish(new Error('CODEX_CATALOG_INVALID')) }
        }
      })
      send('initialize', { clientInfo: { name: 'clideck_pipeline_pool', version: '2.0' }, capabilities: { experimentalApi: true } }, requestId)
    })
    return models.length ? { ...base, models } : { ...base, error: 'CODEX_CATALOG_UNAVAILABLE' }
  } catch {
    return { ...base, error: 'CODEX_CATALOG_UNAVAILABLE' }
  } finally {
    child.kill('SIGTERM')
    const termination = setTimeout(() => child.kill('SIGKILL'), 3_000)
    termination.unref()
    child.once('exit', () => clearTimeout(termination))
  }
}
