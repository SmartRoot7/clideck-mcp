import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  callPublicMcpTool,
  MAX_MCP_BODY_BYTES,
  publicMcpBodyBytes,
  PublicMcpError,
  serializePublicMcpToolCall,
} from './mcp-client'

afterEach(() => vi.restoreAllMocks())

describe('same-origin public MCP client', () => {
  it('uses the stateless tools/call contract and returns structured content', async () => {
    const fetchMock = vi.spyOn(window, 'fetch').mockResolvedValue(new Response(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        result: { structuredContent: { result: 'passed' } }
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ))

    await expect(callPublicMcpTool<{ result: string }>(
      'verify_network_change',
      { verification_token: 'vfy_test' },
    )).resolves.toEqual({ result: 'passed' })

    const [, init] = fetchMock.mock.calls[0]!
    expect(fetchMock.mock.calls[0]![0]).toBe('/mcp')
    expect(init).toMatchObject({
      method: 'POST',
      credentials: 'same-origin',
      headers: expect.objectContaining({
        'mcp-protocol-version': '2025-11-25'
      })
    })
    expect(JSON.parse(String(init?.body))).toMatchObject({
      method: 'tools/call',
      params: { name: 'verify_network_change' }
    })
  })

  it('does not interpret MCP tool failures as success', async () => {
    vi.spyOn(window, 'fetch').mockResolvedValue(new Response(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        result: {
          isError: true,
          content: [{ type: 'text', text: 'RATE_LIMITED' }]
        }
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ))

    await expect(callPublicMcpTool('query_network_knowledge', {}))
      .rejects.toEqual(expect.objectContaining<Partial<PublicMcpError>>({
        code: 'MCP_TOOL_ERROR',
        message: 'RATE_LIMITED'
      }))
  })

  it('measures the serialized UTF-8 envelope, including Unicode and escaping', () => {
    const args = { snapshot: 'IOS XE \\ path — 密码 🔐' }
    const serialized = serializePublicMcpToolCall('analyze_device_snapshot', args, 7)

    expect(publicMcpBodyBytes('analyze_device_snapshot', args)).toBe(
      new TextEncoder().encode(
        serializePublicMcpToolCall('analyze_device_snapshot', args),
      ).byteLength,
    )
    expect(new TextEncoder().encode(serialized).byteLength).toBeGreaterThan(
      serialized.length,
    )
  })

  it('rejects an oversized request before any network call', async () => {
    const fetchMock = vi.spyOn(window, 'fetch')
    const args = { snapshot: '密'.repeat(MAX_MCP_BODY_BYTES) }

    expect(publicMcpBodyBytes('analyze_device_snapshot', args)).toBeGreaterThan(
      MAX_MCP_BODY_BYTES,
    )
    await expect(callPublicMcpTool('analyze_device_snapshot', args)).rejects.toEqual(
      expect.objectContaining<Partial<PublicMcpError>>({
        code: 'MCP_REQUEST_TOO_LARGE',
      }),
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
