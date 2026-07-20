import { createHash } from 'node:crypto'

import { sanitizeSnapshot } from './snapshot.js'

type NodeKind = 'device' | 'hop' | 'network' | 'unknown'
type Protocol = 'cdp' | 'lldp' | 'route' | 'traceroute'

type GraphNode = {
  id: string
  label: string
  kind: NodeKind
  attributes: Record<string, string>
}

type GraphEdge = {
  id: string
  source: string
  target: string
  local_interface: string | null
  remote_interface: string | null
  protocol: Protocol
}

function stableId(kind: string, label: string): string {
  return `${kind}_${createHash('sha256')
    .update(label.toLowerCase(), 'utf8')
    .digest('hex')
    .slice(0, 16)}`
}

function autoType(content: string): Protocol | null {
  if (/Device ID\s*:|Port ID \(outgoing port\)|Device ID\s+Local Intrfce/i.test(content)) return 'cdp'
  if (/Local (?:Intf|Interface)\s*:|System Name\s*:|Chassis id\s*:/i.test(content)) return 'lldp'
  if (/traceroute to|^\s*\d+\s+(?:\S+\s+)?\(?\d{1,3}(?:\.\d{1,3}){3}/mi.test(content)) {
    return 'traceroute'
  }
  if (/Routing entry for|is directly connected|\bvia\s+\d{1,3}(?:\.\d{1,3}){3}/i.test(content)) {
    return 'route'
  }
  return null
}

function sameIdentity(left: string, right: string): boolean {
  const normalize = (value: string) =>
    value
      .trim()
      .replace(/[;,]+$/g, '')
      .toLowerCase()
      .replace(/\.(?:local|lan)$/i, '')
  return normalize(left) === normalize(right)
}

function addNode(
  nodes: Map<string, GraphNode>,
  label: string,
  kind: NodeKind,
  attributes: Record<string, string> = {},
): string {
  const id = stableId(kind, label)
  const existing = nodes.get(id)
  nodes.set(id, {
    id,
    label,
    kind,
    attributes: { ...existing?.attributes, ...attributes }
  })
  return id
}

function parseCdp(
  localLabel: string,
  content: string,
  nodes: Map<string, GraphNode>,
  edges: GraphEdge[],
): { parsed: number; selfLoops: number } {
  const localId = addNode(nodes, localLabel, 'device')
  const blocks = content.split(/(?=Device ID\s*:)/i)
  let parsed = 0
  let selfLoops = 0
  for (const block of blocks) {
    const remote = block.match(/Device ID\s*:\s*([^\s;,]+)/i)?.[1]
    if (!remote) continue
    const platform = block.match(/Platform:\s*([^,\r\n]+)/i)?.[1]?.trim()
    const address = block.match(/IP address:\s*(\S+)/i)?.[1]
    const localInterface = block.match(/(?:Interface|Local Interface)\s*:\s*([^,;\r\n]+)/i)?.[1]?.trim()
    const remoteInterface =
      block.match(/Port ID \(outgoing port\)\s*:\s*([^;\r\n]+)/i)?.[1]?.trim()
    if (sameIdentity(localLabel, remote)) {
      selfLoops += 1
      continue
    }
    const remoteId = addNode(nodes, remote, 'device', {
      ...(platform ? { platform } : {}),
      ...(address ? { management_address: address } : {})
    })
    edges.push({
      id: stableId('edge', `${localId}:${remoteId}:cdp:${localInterface ?? ''}`),
      source: localId,
      target: remoteId,
      local_interface: localInterface ?? null,
      remote_interface: remoteInterface ?? null,
      protocol: 'cdp'
    })
    parsed += 1
  }
  if (parsed === 0) {
    for (const line of content.split(/\r?\n/)) {
      if (/Device ID\s+Local Intrfce|^-{3,}/i.test(line)) continue
      const columns = line.trim().split(/\s{2,}|\t+/)
      if (columns.length < 3 || !columns[0] || !columns[1]) continue
      const remote = columns[0]
      if (sameIdentity(localLabel, remote)) {
        selfLoops += 1
        continue
      }
      const remoteId = addNode(nodes, remote, 'device')
      edges.push({
        id: stableId('edge', `${localId}:${remoteId}:cdp:${columns[1]}`),
        source: localId,
        target: remoteId,
        local_interface: columns[1] ?? null,
        remote_interface: columns.at(-1) ?? null,
        protocol: 'cdp'
      })
      parsed += 1
    }
  }
  return { parsed, selfLoops }
}

function parseLldp(
  localLabel: string,
  content: string,
  nodes: Map<string, GraphNode>,
  edges: GraphEdge[],
): { parsed: number; selfLoops: number } {
  const localId = addNode(nodes, localLabel, 'device')
  const blocks = content.split(/-{4,}|(?=Local (?:Intf|Interface)\s*:)/i)
  let parsed = 0
  let selfLoops = 0
  for (const block of blocks) {
    const localInterface = block.match(/Local (?:Intf|Interface)\s*:\s*([^;\r\n]+)/i)?.[1]?.trim()
    const remote =
      block.match(/System Name\s*:\s*([^;\r\n]+)/i)?.[1]?.trim() ??
      block.match(/Chassis id\s*:\s*([^;\r\n]+)/i)?.[1]?.trim()
    if (!remote) continue
    const remoteInterface = block.match(/Port (?:id|ID)\s*:\s*([^;\r\n]+)/i)?.[1]?.trim()
    const address =
      block.match(/Management Address(?:es)?:?\s*([^\s\r\n]+)/i)?.[1]
    if (sameIdentity(localLabel, remote)) {
      selfLoops += 1
      continue
    }
    const remoteId = addNode(nodes, remote, 'device', {
      ...(address ? { management_address: address } : {})
    })
    edges.push({
      id: stableId('edge', `${localId}:${remoteId}:lldp:${localInterface ?? ''}`),
      source: localId,
      target: remoteId,
      local_interface: localInterface ?? null,
      remote_interface: remoteInterface ?? null,
      protocol: 'lldp'
    })
    parsed += 1
  }
  return { parsed, selfLoops }
}

function parseTraceroute(
  localLabel: string,
  content: string,
  nodes: Map<string, GraphNode>,
  edges: GraphEdge[],
): { parsed: number; hops: string[]; incomplete: boolean } {
  const sourceId = addNode(nodes, localLabel, 'device')
  const hops: string[] = [sourceId]
  let previous = sourceId
  let parsed = 0
  let incomplete = false
  for (const line of content.replace(/;\s*(?=\d+\s+)/g, '\n').split(/\r?\n/)) {
    const hopNumber = line.match(/^\s*(\d+)\s+/)?.[1]
    if (!hopNumber) continue
    if (/\*\s+\*\s+\*/.test(line)) {
      incomplete = true
      const unknownId = addNode(nodes, `Unanswered hop ${hopNumber}`, 'unknown')
      edges.push({
        id: stableId('edge', `${previous}:${unknownId}:traceroute`),
        source: previous,
        target: unknownId,
        local_interface: null,
        remote_interface: null,
        protocol: 'traceroute'
      })
      hops.push(unknownId)
      previous = unknownId
      parsed += 1
      continue
    }
    const address =
      line.match(/\((\d{1,3}(?:\.\d{1,3}){3})\)/)?.[1] ??
      line.match(/\b(\d{1,3}(?:\.\d{1,3}){3})\b/)?.[1]
    const label = line
      .replace(/^\s*\d+\s+/, '')
      .split(/\s+/)[0]
    if (!address && !label) continue
    const hopId = addNode(nodes, label ?? address!, 'hop', {
      ...(address ? { address } : {}),
      hop: hopNumber
    })
    edges.push({
      id: stableId('edge', `${previous}:${hopId}:traceroute`),
      source: previous,
      target: hopId,
      local_interface: null,
      remote_interface: null,
      protocol: 'traceroute'
    })
    hops.push(hopId)
    previous = hopId
    parsed += 1
  }
  return { parsed, hops, incomplete }
}

function parseRoutes(
  localLabel: string,
  content: string,
  nodes: Map<string, GraphNode>,
  edges: GraphEdge[],
): number {
  const localId = addNode(nodes, localLabel, 'device')
  let parsed = 0
  const destination =
    content.match(/Routing entry for\s+(\S+)/i)?.[1] ??
    content.match(/^\s*[A-Z*]+\s+(\d{1,3}(?:\.\d{1,3}){3}\/\d+)/m)?.[1]
  if (!destination) return 0
  const networkId = addNode(nodes, destination, 'network')
  const via =
    content.match(/\bvia\s+(\d{1,3}(?:\.\d{1,3}){3})/i)?.[1] ??
    content.match(/^\s*\*?\s*(\d{1,3}(?:\.\d{1,3}){3})(?:,|\s)/m)?.[1]
  if (via) {
    const hopId = addNode(nodes, via, 'hop', { address: via })
    edges.push({
      id: stableId('edge', `${localId}:${hopId}:route`),
      source: localId,
      target: hopId,
      local_interface: null,
      remote_interface: null,
      protocol: 'route'
    })
    edges.push({
      id: stableId('edge', `${hopId}:${networkId}:route`),
      source: hopId,
      target: networkId,
      local_interface: null,
      remote_interface: null,
      protocol: 'route'
    })
    parsed += 2
  } else if (/directly connected/i.test(content)) {
    const localInterface =
      content.match(/directly connected,\s*(\S+)/i)?.[1] ?? null
    edges.push({
      id: stableId('edge', `${localId}:${networkId}:route`),
      source: localId,
      target: networkId,
      local_interface: localInterface,
      remote_interface: null,
      protocol: 'route'
    })
    parsed += 1
  }
  return parsed
}

export function analyzeNetworkPath(input: {
  snapshots: Array<{
    device_hint: string
    output_type: 'auto' | 'cdp' | 'lldp' | 'route' | 'traceroute'
    content: string
  }>
  source?: string | undefined
  destination?: string | undefined
}) {
  const nodes = new Map<string, GraphNode>()
  const edges: GraphEdge[] = []
  const unparsedInputs: string[] = []
  const paths: Array<{
    source: string
    destination: string
    hops: string[]
    complete: boolean
  }> = []
  let probableFaultDomain: string | null = null
  const parseDiagnostics: Array<{
    snapshot_index: number
    requested_type: string
    detected_type: Protocol | null
    status: 'parsed' | 'partial' | 'unparsed'
    records_parsed: number
    warnings: string[]
  }> = []

  for (const [snapshotIndex, untrustedSnapshot] of input.snapshots.entries()) {
    const snapshot = {
      ...untrustedSnapshot,
      device_hint: sanitizeSnapshot(
        untrustedSnapshot.device_hint,
        'secrets_only',
      ).sanitized,
      content: sanitizeSnapshot(
        untrustedSnapshot.content,
        'secrets_only',
      ).sanitized
    }
    const type =
      snapshot.output_type === 'auto'
        ? autoType(snapshot.content)
        : snapshot.output_type
    let parsed = 0
    const warnings: string[] = []
    if (type === 'cdp') {
      const result = parseCdp(snapshot.device_hint, snapshot.content, nodes, edges)
      parsed = result.parsed
      if (result.selfLoops > 0) warnings.push('self_reference_ignored')
    } else if (type === 'lldp') {
      const result = parseLldp(snapshot.device_hint, snapshot.content, nodes, edges)
      parsed = result.parsed
      if (result.selfLoops > 0) warnings.push('self_reference_ignored')
    } else if (type === 'route') {
      parsed = parseRoutes(snapshot.device_hint, snapshot.content, nodes, edges)
    } else if (type === 'traceroute') {
      const trace = parseTraceroute(
        snapshot.device_hint,
        snapshot.content,
        nodes,
        edges,
      )
      parsed = trace.parsed
      if (trace.hops.length > 1) {
        const requestedDestination = input.destination
          ? sanitizeSnapshot(
              input.destination,
              'secrets_only',
            ).sanitized
          : undefined
        const lastLabel = nodes.get(trace.hops.at(-1)!)?.label
        paths.push({
          source: input.source
            ? sanitizeSnapshot(input.source, 'secrets_only').sanitized
            : snapshot.device_hint,
          destination: requestedDestination ?? lastLabel ?? 'unknown',
          hops: trace.hops,
          complete:
            !trace.incomplete &&
            (
              !requestedDestination ||
              Boolean(lastLabel && sameIdentity(lastLabel, requestedDestination)) ||
              Boolean(
                requestedDestination &&
                nodes.get(trace.hops.at(-1)!)?.attributes['address'] ===
                  requestedDestination,
              )
            )
        })
      }
      if (trace.incomplete && trace.hops.length >= 2) {
        const precedingNode = nodes.get(trace.hops.at(-2)!)
        if (precedingNode && precedingNode.kind !== 'unknown') {
          probableFaultDomain = precedingNode.label
        }
      }
    }
    if (!type || parsed === 0) unparsedInputs.push(snapshot.device_hint)
    parseDiagnostics.push({
      snapshot_index: snapshotIndex,
      requested_type: snapshot.output_type,
      detected_type: type,
      status: parsed === 0
        ? 'unparsed'
        : warnings.length > 0
          ? 'partial'
          : 'parsed',
      records_parsed: parsed,
      warnings
    })
  }

  const deduplicatedEdges = [
    ...new Map(edges.map((edge) => [edge.id, edge])).values()
  ]
  const findings = [
    `${nodes.size} nodes and ${deduplicatedEdges.length} links were parsed.`,
    ...(probableFaultDomain
      ? [`The first unanswered traceroute transition follows ${probableFaultDomain}.`]
      : []),
    ...(unparsedInputs.length > 0
      ? [`${unparsedInputs.length} input snapshots require another parser.`]
      : [])
  ]

  return {
    nodes: [...nodes.values()],
    edges: deduplicatedEdges,
    paths,
    probable_fault_domain: probableFaultDomain,
    findings,
    unparsed_inputs: unparsedInputs,
    parse_diagnostics: parseDiagnostics,
    retention: 'not_stored' as const,
    limitations: [
      'The graph represents only the supplied snapshots and is not a live digital twin.',
      'Missing discovery or routing data can make a path incomplete.'
    ]
  }
}
