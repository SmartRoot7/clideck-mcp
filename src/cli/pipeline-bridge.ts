export async function callPipelineBridge(
  environment: NodeJS.ProcessEnv,
  name: string,
  args: Record<string, unknown>,
  researcherId = 'pipeline-pool',
) {
  const response = await fetch(environment['CLIDECK_RESEARCHER_URL']!, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${environment['CLIDECK_RESEARCHER_TOKEN']!}`,
      'x-researcher-id': researcherId,
      'x-researcher-instance-id': `${researcherId}:runtime-v2`,
      'content-type': 'application/json', accept: 'application/json, text/event-stream',
      'mcp-protocol-version': '2025-11-25'
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
    signal: AbortSignal.timeout(30_000)
  })
  if (!response.ok) throw new Error(`PIPELINE_BRIDGE_HTTP_${response.status}`)
  const rpc = await response.json() as {
    result?: { isError?: boolean; structuredContent?: Record<string, unknown> }; error?: unknown
  }
  if (rpc.error || rpc.result?.isError || !rpc.result?.structuredContent) throw new Error('PIPELINE_BRIDGE_TOOL_FAILED')
  return rpc.result.structuredContent
}
