import { randomUUID } from 'node:crypto'

import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { secureHeaders } from 'hono/secure-headers'
import { timeout } from 'hono/timeout'

import type { AppConfig } from '../config.js'
import type { Database } from '../db.js'
import type { Logger } from '../logger.js'
import { createResearcherMcpServer } from '../mcp/researcher-server.js'
import { requireStaticBearer } from './security.js'

export function createResearcherApp(dependencies: {
  config: AppConfig
  database: Database
  logger: Logger
}) {
  const { config, database, logger } = dependencies
  const app = new Hono()

  app.use('*', secureHeaders())
  app.use(
    '*',
    bodyLimit({
      maxSize: config.maxRequestBytes,
      onError: (context) =>
        context.json({ error: 'request_body_too_large' }, 413)
    }),
  )
  app.use('*', timeout(30_000))
  app.get('/health', (context) => context.json({ status: 'ok' }))
  app.use('/mcp', requireStaticBearer(config.researcherToken))
  app.use('/mcp', async (_context, next) => {
    await database.query(
      `INSERT INTO worker_heartbeats (
         worker_name, instance_id, heartbeat_at, metadata
       )
       VALUES (
         'researcher-bridge',
         'restricted-mcp',
         now(),
         '{"status":"running"}'::jsonb
       )
       ON CONFLICT (worker_name)
       DO UPDATE SET
         instance_id = excluded.instance_id,
         heartbeat_at = excluded.heartbeat_at,
         metadata = excluded.metadata`,
    )
    await next()
  })
  app.all('/mcp', async (context) => {
    const requestedResearcherId =
      context.req.header('x-researcher-id')?.slice(0, 120)
    const researcherId =
      requestedResearcherId &&
      /^[A-Za-z0-9][A-Za-z0-9_.:-]{2,119}$/.test(requestedResearcherId)
        ? requestedResearcherId
        : `codex-${randomUUID()}`
    const requestedInstanceId =
      context.req.header('x-researcher-instance-id')?.slice(0, 200)
    const researcherInstanceId =
      requestedInstanceId &&
      /^[A-Za-z0-9][A-Za-z0-9_.:-]{2,199}$/.test(requestedInstanceId)
        ? requestedInstanceId
        : researcherId
    const server = createResearcherMcpServer({
      config,
      database,
      logger,
      researcherId,
      researcherInstanceId
    })
    const transport = new WebStandardStreamableHTTPServerTransport({
      enableJsonResponse: true
    })
    await server.connect(transport)
    return transport.handleRequest(context.req.raw)
  })
  app.notFound((context) => context.json({ error: 'not_found' }, 404))
  app.onError((error, context) => {
    logger.error({ err: error }, 'Unhandled researcher API error')
    return context.json({ error: 'internal_error' }, 500)
  })
  return app
}
