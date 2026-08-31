import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { WebMcpApp } from './webmcp-app'

type RegisteredTool = {
  name: string
  annotations?: { readOnlyHint?: boolean; untrustedContentHint?: boolean }
  execute: (
    args: Record<string, unknown>,
    options?: { signal?: AbortSignal },
  ) => Promise<string>
}

const registry = new Map<string, RegisteredTool>()

function mcpResponse(structuredContent: unknown) {
  return new Response(JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    result: { structuredContent }
  }), { status: 200, headers: { 'content-type': 'application/json' } })
}

function request(init?: RequestInit) {
  return JSON.parse(String(init?.body)).params as {
    name: string
    arguments: Record<string, unknown>
  }
}

const answer = {
  revision_ref: '11111111-1111-4111-8111-111111111111',
  kind: 'workflow',
  title: 'Upgrade Catalyst 9300 in install mode',
  summary: 'Use the documented install workflow for this IOS XE release.',
  applicability: {
    vendor: 'Cisco',
    model: 'C9300-24T',
    operating_system: 'Cisco IOS XE',
    versions: { minimum: '17.3.2a', maximum: null, requested: '17.8.1' },
    assurance_level: 'exact',
    version_match: 'explicit_range'
  },
  cli_mode: 'privileged EXEC',
  command: 'install add file flash:cat9k.bin activate commit',
  procedure: ['Copy the image', 'Run the install command'],
  prerequisites: ['Verify storage'],
  risks: [],
  verification: ['show version'],
  rollback: ['install rollback to committed'],
  limitations: [],
  confidence: 0.98,
  quality_score: 0.97,
  dangerous: false,
  last_verified_at: '2026-08-29',
  assurance: {
    validation_level: 'documentation_reviewed',
    confidence_explanation: 'Official documentation.'
  }
}

beforeEach(() => {
  registry.clear()
  Object.defineProperty(document, 'modelContext', {
    configurable: true,
    value: {
      registerTool(tool: RegisteredTool, options: { signal: AbortSignal }) {
        registry.set(tool.name, tool)
        options.signal.addEventListener('abort', () => {
          if (registry.get(tool.name) === tool) registry.delete(tool.name)
        }, { once: true })
        return Promise.resolve()
      }
    }
  })
  vi.spyOn(window, 'fetch').mockImplementation(async (_input, init) => {
    const call = request(init)
    switch (call.name) {
      case 'analyze_device_snapshot':
        return mcpResponse({
          context: {
            vendor: 'Cisco',
            model: 'C9300-24T',
            operating_system: 'Cisco IOS XE',
            version: '17.8.1',
            support_level: 'deep',
            confidence: 0.99,
            ambiguities: []
          },
          snapshot_type: 'show_version',
          sanitized_snapshot: String(call.arguments.snapshot),
          redactions: [],
          limitations: []
        })
      case 'query_network_knowledge':
      case 'get_network_workflow':
        return mcpResponse({
          answers: [answer],
          unknown: false,
          answer_status: 'complete',
          next_action: 'use_answer'
        })
      case 'get_knowledge_provenance':
        return mcpResponse({
          revisions: [{
            revision_ref: answer.revision_ref,
            sources: [{
              source_ref: 'src_123456789abc',
              source_kind: 'official_web',
              title: 'Cisco Catalyst 9300 Upgrade Guide',
              url: 'https://www.cisco.com/example',
              document_version: '17.8',
              document_date: '2026-08-20',
              verified_at: '2026-08-29'
            }]
          }]
        })
      case 'request_expert_answer':
        return mcpResponse({
          task_id: 'task-123',
          access_token: 'SERVER-ONLY-TOKEN',
          status: 'queued',
          stage: 'queued',
          progress_percent: 0,
          poll_after_ms: 30_000,
          input_request: null,
          answer: null,
          failure: null,
          milestones: []
        })
      case 'get_expert_task':
        return mcpResponse({
          task_id: 'task-123',
          status: 'researching',
          stage: 'researching',
          progress_percent: 25,
          poll_after_ms: 30_000,
          input_request: null,
          answer: null,
          failure: null,
          milestones: []
        })
      default:
        return new Response('not found', { status: 404 })
    }
  })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  Reflect.deleteProperty(document, 'modelContext')
})

async function runTool(
  name: string,
  args: Record<string, unknown>,
  signal = new AbortController().signal,
) {
  const tool = registry.get(name)
  if (!tool) throw new Error(`${name} is not registered`)
  let result: Awaited<ReturnType<RegisteredTool['execute']>> | undefined
  await act(async () => {
    result = await tool.execute(args, { signal })
  })
  return result!
}

describe('Network Evidence Workbench', () => {
  it('registers six stable tools and keeps manual controls usable', async () => {
    render(<WebMcpApp />)

    await waitFor(() => expect(registry.size).toBe(6))
    expect([...registry.keys()]).toEqual([
      'read_network_case',
      'analyze_network_case',
      'search_network_case',
      'present_network_case_analysis',
      'start_case_research',
      'get_case_research_status'
    ])
    expect(registry.get('read_network_case')?.annotations).toMatchObject({
      readOnlyHint: true,
      untrustedContentHint: true
    })
    expect(screen.getByRole('button', { name: /upload files/i })).toBeEnabled()
    expect(screen.getByRole('button', { name: /analyze evidence/i })).toBeDisabled()
    expect(screen.getByText(/nothing here connects to or changes/i)).toBeInTheDocument()
  })

  it('never exposes evidence to the browser agent before the sharing toggle', async () => {
    render(<WebMcpApp />)
    fireEvent.click(screen.getByRole('button', { name: /load cisco 17\.8\.1 sample/i }))

    const blocked = await runTool('read_network_case', { offset: 0, max_chars: 8000 })
      .catch((error) => error)
    expect(blocked).toEqual(expect.objectContaining({
      message: 'EVIDENCE_ACCESS_NOT_GRANTED'
    }))

    fireEvent.click(screen.getByRole('checkbox', {
      name: /share redacted evidence with browser agent/i
    }))
    const allowed = await runTool('read_network_case', { offset: 0, max_chars: 8000 })
    const payload = JSON.parse(allowed)
    expect(payload.evidence).toContain('Cisco IOS XE Software')
    expect(payload.evidence).not.toContain('SAMPLE17X81')
    expect(payload.files).toEqual([])
  })

  it('runs the real manual analyze and knowledge flow with provenance', async () => {
    render(<WebMcpApp />)
    fireEvent.click(screen.getByRole('button', { name: /load cisco 17\.8\.1 sample/i }))
    fireEvent.click(screen.getByRole('button', { name: /analyze evidence/i }))

    await waitFor(() => expect(screen.getByDisplayValue('C9300-24T')).toBeInTheDocument())
    expect(screen.getByDisplayValue('17.8.1')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /search knowledge/i }))

    await screen.findByText('Upgrade Catalyst 9300 in install mode')
    expect(screen.getByText('Cisco Catalyst 9300 Upgrade Guide')).toBeInTheDocument()
    expect(screen.getByText(/install add file flash:cat9k\.bin/i)).toBeInTheDocument()
    expect(screen.getByText(/Case v3/i)).toBeInTheDocument()
  })

  it('does not mix another vendor when current-vendor guidance exists', async () => {
    const hpeAnswer = {
      ...answer,
      revision_ref: '33333333-3333-4333-8333-333333333333',
      title: 'HPE fast software upgrade',
      applicability: {
        ...answer.applicability,
        vendor: 'Hpe',
        operating_system: 'ArubaOS Switch',
        version_match: 'same_branch_fallback'
      }
    }
    vi.mocked(window.fetch).mockImplementation(async (_input, init) => {
      const call = request(init)
      if (call.name === 'analyze_device_snapshot') {
        return mcpResponse({
          context: {
            vendor: 'Cisco', model: 'C9300-24T',
            operating_system: 'Cisco IOS XE', version: '17.8.1',
            support_level: 'deep', confidence: 0.99, ambiguities: []
          },
          snapshot_type: 'show_version', sanitized_snapshot: '',
          redactions: [], limitations: []
        })
      }
      if (call.name === 'query_network_knowledge') {
        return mcpResponse({
          answers: [hpeAnswer, answer], unknown: false,
          answer_status: 'complete', next_action: 'use_answer'
        })
      }
      if (call.name === 'get_knowledge_provenance') {
        return mcpResponse({ revisions: [] })
      }
      return new Response('not found', { status: 404 })
    })
    render(<WebMcpApp />)
    fireEvent.click(screen.getByRole('button', { name: /load cisco 17\.8\.1 sample/i }))
    fireEvent.click(screen.getByRole('button', { name: /analyze evidence/i }))
    await waitFor(() => expect(screen.getByDisplayValue('17.8.1')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /search knowledge/i }))

    await screen.findByText('Upgrade Catalyst 9300 in install mode')
    expect(screen.queryByText('HPE fast software upgrade')).not.toBeInTheDocument()
  })

  it('returns compact analysis metadata without echoing sanitized evidence', async () => {
    render(<WebMcpApp />)
    fireEvent.click(screen.getByRole('button', { name: /load cisco 17\.8\.1 sample/i }))
    fireEvent.click(screen.getByRole('checkbox', {
      name: /share redacted evidence with browser agent/i
    }))

    const output = JSON.parse(await runTool('analyze_network_case', {
      expected_case_version: 2
    }))

    expect(output.case_version).toBe(3)
    expect(output.context).toMatchObject({ vendor: 'Cisco', version: '17.8.1' })
    expect(output).not.toHaveProperty('sanitized_snapshot')
    expect(JSON.stringify(output)).not.toContain('Cisco IOS XE Software')
  })

  it('keeps task credentials in page memory and rejects stale research status', async () => {
    render(<WebMcpApp />)
    fireEvent.click(screen.getByRole('button', { name: /load cisco 17\.8\.1 sample/i }))
    fireEvent.click(screen.getByRole('button', { name: /analyze evidence/i }))
    await waitFor(() => expect(screen.getByDisplayValue('17.8.1')).toBeInTheDocument())

    vi.mocked(window.fetch).mockImplementation(async (_input, init) => {
      const call = request(init)
      if (call.name === 'query_network_knowledge' || call.name === 'get_network_workflow') {
        return mcpResponse({
          answers: [], unknown: true, answer_status: 'unknown',
          next_action: 'request_expert_answer'
        })
      }
      if (call.name === 'request_expert_answer') {
        return mcpResponse({
          task_id: 'task-123', access_token: 'SERVER-ONLY-TOKEN',
          status: 'queued', stage: 'queued', progress_percent: 0,
          poll_after_ms: 30_000, input_request: null, answer: null,
          failure: null, milestones: []
        })
      }
      if (call.name === 'get_knowledge_provenance') {
        return mcpResponse({ revisions: [] })
      }
      return new Response('not found', { status: 404 })
    })

    await runTool('search_network_case', {
      expected_case_version: 3, mode: 'both', limit: 3
    })
    const started = await runTool('start_case_research', {
      expected_case_version: 3
    })
    expect(started).not.toContain('SERVER-ONLY-TOKEN')

    let resolveStatus!: (response: Response) => void
    vi.mocked(window.fetch).mockImplementation((_input, init) => {
      const call = request(init)
      if (call.name !== 'get_expert_task') return Promise.resolve(new Response('not found', { status: 404 }))
      expect(call.arguments.access_token).toBe('SERVER-ONLY-TOKEN')
      return new Promise((resolve) => { resolveStatus = resolve })
    })
    const statusPromise = runTool('get_case_research_status', {
      expected_case_version: 3
    }).catch((error) => error)
    fireEvent.change(screen.getByPlaceholderText(/what do you need/i), {
      target: { value: 'A changed question' }
    })
    resolveStatus(mcpResponse({
      task_id: 'task-123', access_token: 'SERVER-ONLY-TOKEN',
      status: 'completed', stage: 'completed', progress_percent: 100,
      poll_after_ms: 30_000, input_request: null, answer: null,
      failure: null, milestones: []
    }))

    const stale = await statusPromise
    expect(stale).toEqual(expect.objectContaining({ message: 'CASE_VERSION_CONFLICT' }))
    expect(JSON.stringify(stale)).not.toContain('SERVER-ONLY-TOKEN')
  })

  it('rejects stale versions and citations outside the current result set', async () => {
    render(<WebMcpApp />)
    await waitFor(() => expect(registry.size).toBe(6))

    const stale = await runTool('search_network_case', {
      expected_case_version: 999,
      mode: 'both',
      limit: 3
    }).catch((error) => error)
    expect(stale).toEqual(expect.objectContaining({ message: 'CASE_VERSION_CONFLICT' }))

    const invalidCitation = await runTool('present_network_case_analysis', {
      expected_case_version: 1,
      summary: 'Unsupported citation attempt.',
      hypotheses: [],
      next_commands: [],
      revision_refs: ['22222222-2222-4222-8222-222222222222']
    }).catch((error) => error)
    expect(invalidCitation).toEqual(expect.objectContaining({
      message: 'ANALYSIS_CITATION_NOT_IN_CURRENT_RESULTS'
    }))
  })

  it('aborts in-flight MCP work on reset without leaking an error into the new case', async () => {
    render(<WebMcpApp />)
    fireEvent.click(screen.getByRole('button', { name: /load cisco 17\.8\.1 sample/i }))
    fireEvent.click(screen.getByRole('button', { name: /analyze evidence/i }))
    await waitFor(() => expect(screen.getByDisplayValue('C9300-24T')).toBeInTheDocument())

    let requestSignal: AbortSignal | null = null
    vi.mocked(window.fetch).mockImplementation((_input, init) => {
      requestSignal = init?.signal as AbortSignal
      return new Promise((_resolve, reject) => {
        requestSignal?.addEventListener('abort', () => {
          reject(new DOMException('aborted', 'AbortError'))
        }, { once: true })
      })
    })
    fireEvent.click(screen.getByRole('button', { name: /search knowledge/i }))
    fireEvent.click(screen.getByRole('button', { name: /reset/i }))

    await waitFor(() => expect(requestSignal?.aborted).toBe(true))
    expect(screen.getByPlaceholderText(/what do you need/i)).toHaveValue('')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /upload files/i })).toBeEnabled()
  })

  it('propagates the execution signal and aborts work on unmount', async () => {
    const rendered = render(<WebMcpApp />)
    fireEvent.click(screen.getByRole('button', { name: /load cisco 17\.8\.1 sample/i }))
    fireEvent.click(screen.getByRole('button', { name: /analyze evidence/i }))
    await waitFor(() => expect(screen.getByDisplayValue('17.8.1')).toBeInTheDocument())

    const observedSignals: AbortSignal[] = []
    vi.mocked(window.fetch).mockImplementation((_input, init) => {
      const signal = init?.signal as AbortSignal
      observedSignals.push(signal)
      return new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => {
          reject(new DOMException('aborted', 'AbortError'))
        }, { once: true })
      })
    })
    const execution = new AbortController()
    const externalAbort = runTool('search_network_case', {
      expected_case_version: 3, mode: 'both', limit: 3
    }, execution.signal).catch((error) => error)
    execution.abort()
    expect(await externalAbort).toEqual(expect.objectContaining({
      code: 'MCP_REQUEST_ABORTED'
    }))
    expect(observedSignals[0]?.aborted).toBe(true)

    const unmountWork = runTool('search_network_case', {
      expected_case_version: 3, mode: 'both', limit: 3
    }).catch((error) => error)
    rendered.unmount()
    expect(await unmountWork).toEqual(expect.objectContaining({
      code: 'MCP_REQUEST_ABORTED'
    }))
    expect(observedSignals.at(-1)?.aborted).toBe(true)
  })

  it('remains useful without WebMCP support', () => {
    Reflect.deleteProperty(document, 'modelContext')
    render(<WebMcpApp />)

    expect(screen.getByText(/manual mode · webmcp unavailable/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /upload files/i })).toBeEnabled()
    expect(screen.getByRole('button', { name: /load cisco 16\.10 sample/i })).toBeEnabled()
  })
})
