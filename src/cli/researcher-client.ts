import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { z } from 'zod'

import { candidateRevisionSchema } from '../domain/schemas.js'

const environmentSchema = z.object({
  CLIDECK_RESEARCHER_URL: z.string().url(),
  CLIDECK_RESEARCHER_TOKEN: z.string().min(32),
  CLIDECK_RESEARCHER_ID: z.string().min(3).max(120).default('codex-automation')
})
const leaseSchema = z.object({
  task_id: z.string().regex(/^ekt_[A-Za-z0-9_-]{32}$/),
  lease_token: z.string().min(32).max(128)
})
const draftCandidateSchema = candidateRevisionSchema.omit({
  task_id: true,
  lease_token: true
})

const environment = environmentSchema.parse(process.env)
const action = process.argv[2]
const secretDirectory = resolve(process.cwd(), '.secrets')
const leasePath = resolve(secretDirectory, 'researcher-lease.json')

async function callTool(
  name: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const response = await fetch(environment.CLIDECK_RESEARCHER_URL, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${environment.CLIDECK_RESEARCHER_TOKEN}`,
      'x-researcher-id': environment.CLIDECK_RESEARCHER_ID,
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
  return leaseSchema.parse(JSON.parse(await readFile(leasePath, 'utf8')))
}

async function run(): Promise<void> {
  await mkdir(secretDirectory, { recursive: true, mode: 0o700 })

  switch (action) {
    case 'claim': {
      const result = await callTool('claim_research_task', {})
      if (result['available'] === false) {
        process.stdout.write('{"available":false}\n')
        return
      }
      const lease = leaseSchema.parse(result)
      await writeFile(leasePath, JSON.stringify(lease), {
        encoding: 'utf8',
        mode: 0o600
      })
      const {
        lease_token: _leaseToken,
        ...safeResult
      } = result
      process.stdout.write(`${JSON.stringify(safeResult, null, 2)}\n`)
      return
    }
    case 'heartbeat': {
      const lease = await readLease()
      const result = await callTool('heartbeat_research_task', lease)
      process.stdout.write(`${JSON.stringify(result)}\n`)
      return
    }
    case 'submit': {
      const candidatePath = process.argv[3]
      if (!candidatePath) throw new Error('Candidate JSON path is required')
      const lease = await readLease()
      const draft = draftCandidateSchema.parse(
        JSON.parse(await readFile(resolve(candidatePath), 'utf8')),
      )
      const result = await callTool('submit_candidate_revision', {
        ...draft,
        ...lease
      })
      await unlink(leasePath).catch(() => undefined)
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
      return
    }
    case 'fail': {
      const failureCode = process.argv[3]
      const failureMessage = process.argv[4]
      if (!failureCode || !failureMessage) {
        throw new Error('Failure code and message are required')
      }
      const lease = await readLease()
      const result = await callTool('fail_research_task', {
        ...lease,
        failure_code: failureCode,
        failure_message: failureMessage
      })
      await unlink(leasePath).catch(() => undefined)
      process.stdout.write(`${JSON.stringify(result)}\n`)
      return
    }
    default:
      throw new Error('Action must be claim, heartbeat, submit, or fail')
  }
}

try {
  await run()
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : 'Researcher client failed'}\n`,
  )
  process.exitCode = 1
}
