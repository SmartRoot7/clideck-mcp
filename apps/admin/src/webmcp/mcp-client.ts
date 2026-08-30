type JsonRpcEnvelope<T> = {
  jsonrpc: '2.0'
  id: number
  result?: {
    structuredContent?: T
    content?: Array<{ type: string; text?: string }>
    isError?: boolean
  }
  error?: {
    code: number
    message: string
  }
}

let requestSequence = 0

export class PublicMcpError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

export async function callPublicMcpTool<T>(
  name: string,
  args: Record<string, unknown>,
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<T> {
  const controller = new AbortController()
  const timeout = window.setTimeout(
    () => controller.abort(new Error('MCP_REQUEST_TIMEOUT')),
    options.timeoutMs ?? 20_000,
  )
  const abortFromCaller = () => controller.abort(options.signal?.reason)
  options.signal?.addEventListener('abort', abortFromCaller, { once: true })
  try {
    const response = await fetch('/mcp', {
      method: 'POST',
      cache: 'no-store',
      credentials: 'same-origin',
      headers: {
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json',
        'mcp-protocol-version': '2025-11-25'
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: ++requestSequence,
        method: 'tools/call',
        params: { name, arguments: args }
      }),
      signal: controller.signal
    })
    if (!response.ok) {
      throw new PublicMcpError(
        `HTTP_${response.status}`,
        `CliDeck MCP returned HTTP ${response.status}.`,
      )
    }
    const payload = await response.json() as JsonRpcEnvelope<T>
    if (payload.error) {
      throw new PublicMcpError(
        `JSON_RPC_${payload.error.code}`,
        payload.error.message,
      )
    }
    if (!payload.result) {
      throw new PublicMcpError('INVALID_MCP_RESPONSE', 'The MCP response has no result.')
    }
    if (payload.result.isError) {
      const message = payload.result.content
        ?.map((item) => item.text)
        .filter(Boolean)
        .join(' ') || 'The MCP tool reported an error.'
      throw new PublicMcpError('MCP_TOOL_ERROR', message)
    }
    if (payload.result.structuredContent === undefined) {
      throw new PublicMcpError(
        'MISSING_STRUCTURED_CONTENT',
        'The MCP tool returned no structured content.',
      )
    }
    return payload.result.structuredContent
  } catch (error) {
    if (controller.signal.aborted && !(error instanceof PublicMcpError)) {
      throw new PublicMcpError('MCP_REQUEST_ABORTED', 'The MCP request was cancelled or timed out.')
    }
    throw error
  } finally {
    window.clearTimeout(timeout)
    options.signal?.removeEventListener('abort', abortFromCaller)
  }
}
