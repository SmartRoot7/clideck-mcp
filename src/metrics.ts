import {
  Counter,
  Gauge,
  Histogram,
  Registry,
  collectDefaultMetrics
} from 'prom-client'

export function createMetrics() {
  const registry = new Registry()
  collectDefaultMetrics({
    register: registry,
    prefix: 'clideck_mcp_'
  })

  const httpRequests = new Counter({
    name: 'clideck_mcp_http_requests_total',
    help: 'HTTP requests handled by route and status',
    labelNames: ['process', 'route', 'method', 'status'] as const,
    registers: [registry]
  })
  const toolDuration = new Histogram({
    name: 'clideck_mcp_tool_duration_seconds',
    help: 'MCP tool execution duration',
    labelNames: ['tool', 'outcome'] as const,
    buckets: [0.01, 0.025, 0.05, 0.1, 0.2, 0.3, 0.5, 1, 2, 5],
    registers: [registry]
  })
  const taskBacklog = new Gauge({
    name: 'clideck_mcp_task_backlog',
    help: 'Number of queued expert tasks',
    registers: [registry]
  })

  return { registry, httpRequests, toolDuration, taskBacklog }
}

export type Metrics = ReturnType<typeof createMetrics>
