import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { describe, expect, it } from 'vitest'

import type { Database } from '../src/db.js'
import { createLogger } from '../src/logger.js'
import { createMetrics } from '../src/metrics.js'
import { createPublicMcpServer } from '../src/mcp/public-server.js'
import { createTestConfig } from './helpers.js'

describe('public MCP publication annotations', () => {
  it('publishes explicit behavior flags and discloses research side effects', async () => {
    const config = createTestConfig()
    // Listing tools must not need a live database or run any tool operation.
    const database = {} as Database
    const server = createPublicMcpServer({
      config, database, quarantineDatabase: database,
      logger: createLogger(config), metrics: createMetrics(),
      actor: { kind: 'anonymous' }, clientKey: 'annotation-test',
      clientAddress: '127.0.0.1', requestId: 'annotation-test'
    })
    const client = new Client({ name: 'annotation-test', version: '1.0.0' })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    try {
      await Promise.all([client.connect(clientTransport), server.connect(serverTransport)])
      const { tools } = await client.listTools()
      expect(tools).toHaveLength(19)
      for (const tool of tools) {
        for (const flag of ['readOnlyHint', 'destructiveHint', 'openWorldHint'] as const) {
          expect(typeof tool.annotations?.[flag], `${tool.name}.${flag}`).toBe('boolean')
        }
      }
      for (const name of [
        'query_domain_knowledge', 'query_network_knowledge', 'get_network_workflow',
        'review_network_change', 'advise_network_upgrade'
      ]) {
        const tool = tools.find((item) => item.name === name)
        expect(tool?.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false })
        expect(tool?.description).toContain('tracked research demand')
      }
      expect(tools.find((tool) => tool.name === 'analyze_device_snapshot')?.annotations)
        .toMatchObject({ readOnlyHint: true, destructiveHint: false, openWorldHint: false })
      expect(tools.find((tool) => tool.name === 'cancel_expert_task')?.annotations)
        .toMatchObject({ readOnlyHint: false, destructiveHint: true })
    } finally {
      await client.close()
      await server.close()
    }
  })
})
