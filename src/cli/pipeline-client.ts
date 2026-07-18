import {
  mkdir,
  readFile,
  unlink,
  writeFile
} from 'node:fs/promises'
import { resolve } from 'node:path'

import { z } from 'zod'

import { candidateKnowledgeSchema } from '../domain/publication.js'
import {
  pipelineExecutorIds,
  pipelineExecutorPaths
} from './pipeline-runtime.js'

const environmentSchema = z.object({
  CLIDECK_RESEARCHER_URL: z.string().url(),
  CLIDECK_RESEARCHER_TOKEN: z.string().min(32),
  CLIDECK_RESEARCHER_ID: z.string().min(3).max(120)
    .regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]+$/)
    .default('pipeline-executor-01'),
  CLIDECK_RESEARCHER_INSTANCE_ID: z.string().min(3).max(200)
    .regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]+$/)
    .default('pipeline-executor-01:manual'),
  CLIDECK_PIPELINE_EXECUTOR_ID: z.enum(pipelineExecutorIds)
    .default(pipelineExecutorIds[0])
})

const pipelineLeaseSchema = z.object({
  pipeline_task_id: z.string().uuid(),
  lease_token: z.string().min(32).max(128),
  agent_run_id: z.string().uuid(),
  task_type: z.string(),
  expert_task_id: z.string().optional()
})

const usageSchema = z.object({
  status: z.enum(['completed', 'failed', 'timed_out', 'cancelled']),
  input_tokens: z.number().int().min(0).default(0),
  cached_input_tokens: z.number().int().min(0).default(0),
  output_tokens: z.number().int().min(0).default(0),
  reasoning_output_tokens: z.number().int().min(0).default(0),
  duration_ms: z.number().int().min(0),
  error_code: z.string().optional()
})

const environment = environmentSchema.parse(process.env)
const action = process.argv[2]
const { secretDirectory } = pipelineExecutorPaths(
  process.cwd(),
  environment.CLIDECK_PIPELINE_EXECUTOR_ID,
)
const leasePath = resolve(secretDirectory, 'pipeline-lease.json')
const taskPath = resolve(secretDirectory, 'pipeline-task.json')

async function callTool(
  name: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const response = await fetch(environment.CLIDECK_RESEARCHER_URL, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${environment.CLIDECK_RESEARCHER_TOKEN}`,
      'x-researcher-id': environment.CLIDECK_RESEARCHER_ID,
      'x-researcher-instance-id':
        environment.CLIDECK_RESEARCHER_INSTANCE_ID,
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': '2025-11-25'
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name, arguments: args }
    }),
    signal: AbortSignal.timeout(30_000)
  })
  if (!response.ok) {
    throw new Error(`Researcher bridge returned HTTP ${response.status}`)
  }
  const rpc = await response.json() as {
    error?: { message?: string }
    result?: {
      isError?: boolean
      content?: Array<{ type: string; text?: string }>
      structuredContent?: Record<string, unknown>
    }
  }
  if (rpc.error || rpc.result?.isError || !rpc.result?.structuredContent) {
    throw new Error(
      rpc.error?.message ??
      rpc.result?.content?.[0]?.text ??
      'Researcher bridge tool failed',
    )
  }
  return rpc.result.structuredContent
}

async function readLease() {
  return pipelineLeaseSchema.parse(
    JSON.parse(await readFile(leasePath, 'utf8')),
  )
}

async function readJson(path: string): Promise<Record<string, unknown>> {
  const parsed: unknown = JSON.parse(
    await readFile(resolve(path), 'utf8'),
  )
  return z.record(z.string(), z.unknown()).parse(parsed)
}

async function cleanup(): Promise<void> {
  await Promise.all([
    unlink(leasePath).catch(() => undefined),
    unlink(taskPath).catch(() => undefined)
  ])
}

async function run(): Promise<void> {
  await mkdir(secretDirectory, { recursive: true, mode: 0o700 })

  switch (action) {
    case 'claim': {
      const result = await callTool('claim_pipeline_task', {})
      if (!result['pipeline_task_id']) {
        await cleanup()
        process.stdout.write(`${JSON.stringify(result)}\n`)
        return
      }
      const payload = z.record(z.string(), z.unknown()).parse(
        result['payload'],
      )
      const expertTaskId =
        typeof payload['task_id'] === 'string'
          ? payload['task_id']
          : undefined
      const lease = pipelineLeaseSchema.parse({
        pipeline_task_id: result['pipeline_task_id'],
        lease_token: result['lease_token'],
        agent_run_id: result['agent_run_id'],
        task_type: result['task_type'],
        ...(expertTaskId ? { expert_task_id: expertTaskId } : {})
      })
      const safeTask = {
        pipeline_task_id: lease.pipeline_task_id,
        agent_run_id: lease.agent_run_id,
        task_type: result['task_type'],
        stage: result['stage'],
        lease_until: result['lease_until'],
        payload
      }
      await writeFile(leasePath, JSON.stringify(lease), {
        encoding: 'utf8',
        mode: 0o600
      })
      await writeFile(taskPath, JSON.stringify(safeTask, null, 2), {
        encoding: 'utf8',
        mode: 0o600
      })
      process.stdout.write(`${JSON.stringify(safeTask)}\n`)
      return
    }
    case 'task': {
      process.stdout.write(await readFile(taskPath, 'utf8'))
      process.stdout.write('\n')
      return
    }
    case 'heartbeat': {
      const lease = await readLease()
      const result = await callTool('heartbeat_pipeline_task', {
        pipeline_task_id: lease.pipeline_task_id,
        lease_token: lease.lease_token
      })
      process.stdout.write(`${JSON.stringify(result)}\n`)
      return
    }
    case 'submit-discovery':
    case 'submit-analysis':
    case 'submit-verification': {
      const draftPath = process.argv[3]
      if (!draftPath) throw new Error('Submission JSON path is required')
      const lease = await readLease()
      const draft = await readJson(draftPath)
      const tool = {
        'submit-discovery': 'submit_source_discovery',
        'submit-analysis': 'submit_fragment_analysis',
        'submit-verification': 'submit_candidate_verification'
      }[action]!
      const result = await callTool(tool, {
        ...draft,
        pipeline_task_id: lease.pipeline_task_id,
        lease_token: lease.lease_token
      })
      process.stdout.write(`${JSON.stringify(result)}\n`)
      return
    }
    case 'submit-expert': {
      const draftPath = process.argv[3]
      if (!draftPath) throw new Error('Candidate JSON path is required')
      const lease = await readLease()
      if (!lease.expert_task_id) {
        throw new Error('Claimed task is not an expert task')
      }
      const draft = await readJson(draftPath)
      const rejection = z.object({
        rejected: z.literal(true),
        reason: z.string().trim().min(12).max(1_000)
      }).safeParse(draft)
      if (rejection.success) {
        const result = await callTool('fail_pipeline_task', {
          pipeline_task_id: lease.pipeline_task_id,
          lease_token: lease.lease_token,
          failure_code: 'EXPERT_NO_VERIFIED_ANSWER',
          failure_message: rejection.data.reason
        })
        process.stdout.write(`${JSON.stringify(result)}\n`)
        return
      }
      const candidate = candidateKnowledgeSchema.parse(draft)
      const result = await callTool('submit_candidate_revision', {
        ...candidate,
        task_id: lease.expert_task_id,
        lease_token: lease.lease_token
      })
      process.stdout.write(`${JSON.stringify(result)}\n`)
      return
    }
    case 'fail': {
      const code = process.argv[3]
      const message = process.argv[4]
      if (!code || !message) {
        throw new Error('Failure code and message are required')
      }
      const lease = await readLease()
      const result = await callTool('fail_pipeline_task', {
        pipeline_task_id: lease.pipeline_task_id,
        lease_token: lease.lease_token,
        failure_code: code,
        failure_message: message
      })
      process.stdout.write(`${JSON.stringify(result)}\n`)
      return
    }
    case 'status': {
      const lease = await readLease()
      const result = await callTool('get_pipeline_task_status', {
        pipeline_task_id: lease.pipeline_task_id
      })
      process.stdout.write(`${JSON.stringify(result)}\n`)
      return
    }
    case 'finish-run': {
      const usagePath = process.argv[3]
      if (!usagePath) throw new Error('Usage JSON path is required')
      const lease = await readLease()
      const usage = usageSchema.parse(await readJson(usagePath))
      const result = await callTool('record_agent_run_result', {
        agent_run_id: lease.agent_run_id,
        ...usage
      })
      await cleanup()
      process.stdout.write(`${JSON.stringify(result)}\n`)
      return
    }
    case 'system-failure': {
      const code = process.argv[3]
      const message = process.argv[4]
      if (!code || !message) {
        throw new Error('System failure code and message are required')
      }
      const result = await callTool('pause_pipeline_system_failure', {
        failure_code: code,
        failure_message: message
      })
      await cleanup()
      process.stdout.write(`${JSON.stringify(result)}\n`)
      return
    }
    case 'cleanup':
      await cleanup()
      return
    default:
      throw new Error(
        'Action must be claim, task, heartbeat, submit-discovery, submit-analysis, submit-verification, submit-expert, fail, status, finish-run, system-failure, or cleanup',
      )
  }
}

try {
  await run()
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : 'Pipeline client failed'}\n`,
  )
  process.exitCode = 1
}
