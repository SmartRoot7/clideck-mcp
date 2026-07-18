import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { access } from 'node:fs/promises'
import { resolve } from 'node:path'

import {
  pipelineExecutorIds,
  pipelineModel,
  pipelineReasoning,
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
  if (stopping) return
  const child = spawn(process.execPath, coordinatorArguments(), {
    cwd: projectRoot,
    env: {
      ...process.env,
      CLIDECK_PIPELINE_MODEL: pipelineModel,
      CLIDECK_PIPELINE_REASONING: pipelineReasoning,
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

for (const executorId of pipelineExecutorIds) spawnExecutor(executorId)

await new Promise<void>((resolvePromise) => {
  const finish = () => {
    void stopPool().finally(resolvePromise)
  }
  process.once('SIGTERM', finish)
  process.once('SIGINT', finish)
})
