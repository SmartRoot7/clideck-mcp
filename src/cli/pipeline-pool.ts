import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { access } from 'node:fs/promises'
import { resolve } from 'node:path'
import { discoverCodexModels } from './codex-model-catalog.js'
import { callPipelineBridge } from './pipeline-bridge.js'

import {
  pipelineExecutorIds,
  type PipelineExecutorId
} from './pipeline-runtime.js'

const projectRoot = process.cwd()
const secretEnvPath = resolve(
  projectRoot,
  '.secrets',
  'researcher-bridge.env',
)
const poolInstanceId = randomUUID().replaceAll('-', '')
const children = new Map<string, ChildProcess>()
let stopping = false
let runtimeUsable = false

await access(secretEnvPath)

function coordinatorArguments(): string[] {
  return [
    `--env-file=${secretEnvPath}`,
    '--import',
    'tsx',
    'src/cli/pipeline-coordinator.ts'
  ]
}

function spawnExecutor(executorId: PipelineExecutorId): void {
  if (stopping || !runtimeUsable || children.has(executorId)) return
  const child = spawn(process.execPath, coordinatorArguments(), {
    cwd: projectRoot,
    env: {
      ...process.env,
      CLIDECK_PIPELINE_EXECUTOR_ID: executorId,
      CLIDECK_RESEARCHER_ID: executorId,
      CLIDECK_RESEARCHER_INSTANCE_ID:
        `${executorId}:${poolInstanceId}`
    },
    stdio: ['ignore', 'ignore', 'inherit']
  })
  children.set(executorId, child)
  child.once('error', (error) => {
    process.stderr.write(
      `${new Date().toISOString()} ${executorId} failed to start: ` +
      `${error.message}\n`,
    )
  })
  child.once('close', () => {
    children.delete(executorId)
    if (!stopping) {
      setTimeout(() => spawnExecutor(executorId), 2_000).unref()
    }
  })
}

async function stopPool(): Promise<void> {
  if (stopping) return
  stopping = true
  const active = [...children.values()]
  for (const child of active) child.kill('SIGTERM')
  await Promise.race([
    Promise.all(active.map((child) =>
      new Promise<void>((resolvePromise) => {
        if (child.exitCode !== null) {
          resolvePromise()
          return
        }
        child.once('close', () => resolvePromise())
      }),
    )),
    new Promise<void>((resolvePromise) => {
      setTimeout(resolvePromise, 11_000).unref()
    })
  ])
  for (const child of active) {
    if (child.exitCode === null) child.kill('SIGKILL')
  }
}

let refreshing = false
let lastCatalogRefresh = 0
async function refreshCatalog(): Promise<void> {
  if (refreshing || stopping) return
  refreshing = true
  try {
    const control = await callPipelineBridge(process.env, 'get_pipeline_runtime_settings', {})
    const requested = typeof control['refresh_requested_at'] === 'string' ? Date.parse(control['refresh_requested_at']) : 0
    if (Date.now() - lastCatalogRefresh < 5 * 60_000 && requested <= lastCatalogRefresh) return
    const report = await discoverCodexModels(process.env['CLIDECK_PIPELINE_CODEX_BINARY'] ?? 'codex', process.env)
    await callPipelineBridge(process.env, 'publish_pipeline_model_catalog', report)
    lastCatalogRefresh = Date.now()
    runtimeUsable = report.error !== 'CODEX_BINARY_UNAVAILABLE' && report.error !== 'CODEX_INCOMPATIBLE'
    if (runtimeUsable) for (const executorId of pipelineExecutorIds) spawnExecutor(executorId)
    if (report.error) process.stderr.write(`${new Date().toISOString()} ${report.error}\n`)
  } catch {
    process.stderr.write(`${new Date().toISOString()} PIPELINE_CATALOG_REPORT_FAILED\n`)
  } finally { refreshing = false }
}
await refreshCatalog()
const catalogTimer = setInterval(() => void refreshCatalog(), 30_000)
for (const executorId of pipelineExecutorIds) spawnExecutor(executorId)
process.once('SIGTERM', () => clearInterval(catalogTimer))
process.once('SIGINT', () => clearInterval(catalogTimer))

await new Promise<void>((resolvePromise) => {
  const finish = () => {
    void stopPool().finally(resolvePromise)
  }
  process.once('SIGTERM', finish)
  process.once('SIGINT', finish)
})
