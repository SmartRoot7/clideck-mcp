import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { RECOVERY_COMMANDS } from './lab-state'
import { WebMcpApp } from './webmcp-app'

type RegisteredTool = {
  name: string
  annotations?: { readOnlyHint?: boolean; untrustedContentHint?: boolean }
  execute: (args: Record<string, unknown>) => Promise<{
    content: Array<{ type: string; text?: string }>
    isError?: boolean
  }>
}

const registry = new Map<string, RegisteredTool>()

function mcpResponse(structuredContent: unknown) {
  return new Response(JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    result: { structuredContent }
  }), { status: 200, headers: { 'content-type': 'application/json' } })
}

function toolNameFromRequest(init?: RequestInit): string {
  return JSON.parse(String(init?.body)).params.name as string
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
      }
    }
  })
  vi.spyOn(window, 'fetch').mockImplementation(async (_input, init) => {
    switch (toolNameFromRequest(init)) {
      case 'analyze_device_snapshot':
        return mcpResponse({
          context: {
            vendor: 'Cisco',
            model: 'C9300-48P',
            operating_system: 'IOS XE',
            version: '17.12.4',
            confidence: 0.99
          },
          redactions: [{ type: 'mac_address', count: 1 }],
          sanitized_snapshot: 'Cisco IOS XE Software, Version 17.12.4\nGigabitEthernet1/0/24 err-disabled down',
          retention: 'not_stored'
        })
      case 'query_network_knowledge':
        return mcpResponse({
          unknown: false,
          answer_status: 'complete',
          answers: [
            {
              revision_ref: '11111111-1111-4111-8111-111111111111',
              kind: 'diagnostic',
              title: 'Recover a port-security err-disabled interface',
              confidence: 0.97,
              last_verified_at: '2026-08-29T00:00:00.000Z'
            },
            {
              revision_ref: '33333333-3333-4333-8333-333333333333',
              kind: 'workflow',
              title: 'Configure, verify, disable, or recover BPDU Guard',
              confidence: 0.96,
              last_verified_at: '2026-08-29T00:00:00.000Z'
            }
          ]
        })
      case 'get_network_workflow':
        return mcpResponse({
          unknown: false,
          answer_status: 'complete',
          answers: [{
            revision_ref: '22222222-2222-4222-8222-222222222222',
            kind: 'workflow',
            title: 'Diagnose, recover, and verify port security',
            confidence: 0.98,
            last_verified_at: '2026-08-29T00:00:00.000Z'
          }]
        })
      case 'review_network_change':
        return mcpResponse({
          risk_level: 'high',
          prechecks: ['Capture before state', 'Confirm console access'],
          rollback: ['Restore the approved prior state'],
          approval_required: true,
          verification_token: `vfy_${'a'.repeat(43)}`
        })
      case 'verify_network_change':
        return mcpResponse({
          result: 'passed',
          checks: [
            { id: 'no_critical_errors', status: 'passed', evidence: 'No critical marker.' },
            { id: 'output_changed', status: 'passed', evidence: 'State changed.' },
            { id: 'interface_state', status: 'passed', evidence: 'Interface is up up.' }
          ],
          rollback_recommended: false,
          next_action: 'Complete the change record.'
        })
      default:
        return new Response('not found', { status: 404 })
    }
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  Reflect.deleteProperty(document, 'modelContext')
})

async function runRegisteredTool(name: string, args: Record<string, unknown>) {
  const tool = registry.get(name)
  if (!tool) throw new Error(`${name} is not registered`)
  let result: Awaited<ReturnType<RegisteredTool['execute']>> | undefined
  await act(async () => {
    result = await tool.execute(args)
  })
  return result!
}

describe('CliDeck Network Change Room', () => {
  it('exposes capabilities in order and never delegates human approval', async () => {
    render(<WebMcpApp />)

    await waitFor(() => expect(registry.has('inspect_lab_device')).toBe(true))
    expect([...registry.keys()]).toEqual(['inspect_lab_device'])
    expect(registry.get('inspect_lab_device')?.annotations).toMatchObject({
      readOnlyHint: true,
      untrustedContentHint: true
    })

    const inspection = await runRegisteredTool('inspect_lab_device', {})
    expect(JSON.parse(inspection.content[0]!.text!)).toMatchObject({
      phase: 'inspected',
      sanitized_snapshot: expect.stringContaining('GigabitEthernet1/0/24')
    })
    await waitFor(() => expect(registry.has('find_network_guidance')).toBe(true))
    expect(registry.has('inspect_lab_device')).toBe(false)

    const guidance = await runRegisteredTool('find_network_guidance', {
      goal: 'Recover Gi1/0/24 after its port-security err-disabled event'
    })
    const guidancePayload = JSON.parse(guidance.content[0]!.text!)
    expect(guidancePayload.recommended_commands).toEqual(RECOVERY_COMMANDS)
    expect(guidancePayload.references).toHaveLength(2)
    expect(guidancePayload.references).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ title: expect.stringMatching(/BPDU/i) })]),
    )
    await waitFor(() => expect(registry.has('stage_network_change')).toBe(true))

    const staged = await runRegisteredTool('stage_network_change', {
      intent: 'Recover the simulated access port safely',
      commands: RECOVERY_COMMANDS
    })
    expect(JSON.parse(staged.content[0]!.text!).commands).toEqual(RECOVERY_COMMANDS)
    await screen.findByRole('button', { name: /approve in sandbox/i })
    expect(registry.has('run_lab_commands')).toBe(false)
    expect([...registry.keys()]).not.toContain('approve_network_change')

    fireEvent.click(screen.getByRole('button', { name: /approve in sandbox/i }))
    await waitFor(() => expect(registry.has('run_lab_commands')).toBe(true))

    await runRegisteredTool('run_lab_commands', { commands: RECOVERY_COMMANDS })
    await waitFor(() => expect(registry.has('verify_lab_change')).toBe(true))
    expect(screen.getAllByText(/Gi1\/0\/24 up\/up/i).length).toBeGreaterThan(0)

    const verification = await runRegisteredTool('verify_lab_change', {})
    expect(JSON.parse(verification.content[0]!.text!)).toMatchObject({
      phase: 'verified',
      result: 'passed'
    })
    await screen.findByText('Verification passed')
    expect(registry.size).toBe(0)
  })

  it('rejects an unsupported batch atomically before review or approval', async () => {
    render(<WebMcpApp />)
    await waitFor(() => expect(registry.has('inspect_lab_device')).toBe(true))
    await runRegisteredTool('inspect_lab_device', {})
    await waitFor(() => expect(registry.has('find_network_guidance')).toBe(true))
    await runRegisteredTool('find_network_guidance', {
      goal: 'Recover Gi1/0/24 after its port-security err-disabled event'
    })
    await waitFor(() => expect(registry.has('stage_network_change')).toBe(true))

    const unsafe: string[] = [...RECOVERY_COMMANDS]
    unsafe[2] = 'write erase'
    const result = await runRegisteredTool('stage_network_change', {
      intent: 'Attempt an unsupported operation',
      commands: unsafe
    })
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toBe('UNSUPPORTED_SANDBOX_COMMAND_SEQUENCE')
    expect(registry.has('stage_network_change')).toBe(true)
    expect(registry.has('run_lab_commands')).toBe(false)
    expect(window.fetch).not.toHaveBeenCalledWith(
      '/mcp',
      expect.objectContaining({ body: expect.stringContaining('review_network_change') }),
    )
  })

  it('shows a useful fallback without WebMCP support', () => {
    Reflect.deleteProperty(document, 'modelContext')
    render(<WebMcpApp />)
    expect(screen.getByText('WebMCP unavailable')).toBeInTheDocument()
    expect(screen.getByText(/ChatGPT’s in-app browser/)).toBeInTheDocument()
  })
})
