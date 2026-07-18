import { serve } from '@hono/node-server'

import { getConfig, requireRuntimeSecret } from '../config.js'
import { createDatabase } from '../db.js'
import { createApiApp } from '../http/api-app.js'
import { createLogger } from '../logger.js'
import { createMetrics } from '../metrics.js'

const config = getConfig()
requireRuntimeSecret('ADMIN_TOKEN', config.adminToken)
requireRuntimeSecret(
  'CLIDECK_MCP_ADMIN_ACTOR_HMAC_SECRET',
  config.adminActorHmacSecret,
)
requireRuntimeSecret(
  'VERIFICATION_SIGNING_KEY',
  config.verificationSigningKey,
)
if (config.enablePlayground) {
  requireRuntimeSecret('PLAYGROUND_TOKEN', config.playgroundToken)
}
const logger = createLogger(config)
const database = createDatabase(config, logger)
const adminDatabase =
  config.adminDatabaseUrl === config.databaseUrl
    ? database
    : createDatabase(config, logger, config.adminDatabaseUrl)
if (
  config.nodeEnv === 'production' &&
  config.quarantineDatabaseUrl === config.databaseUrl
) {
  throw new Error(
    'QUARANTINE_DATABASE_URL must use a separate production database role',
  )
}
const quarantineDatabase =
  config.quarantineDatabaseUrl === config.databaseUrl
    ? database
    : createDatabase(config, logger, config.quarantineDatabaseUrl)
const metrics = createMetrics()
const app = createApiApp({
  config,
  database,
  adminDatabase,
  quarantineDatabase,
  logger,
  metrics
})

const server = serve(
  {
    fetch: app.fetch,
    hostname: config.api.host,
    port: config.api.port,
    serverOptions: {
      requestTimeout: 35_000,
      headersTimeout: 10_000,
      keepAliveTimeout: 5_000
    }
  },
  (info) => {
    logger.info(
      { host: config.api.host, port: info.port },
      'CliDeck MCP API started',
    )
  },
)
if ('maxRequestsPerSocket' in server) {
  server.maxRequestsPerSocket = 1_000
}

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'Shutting down API')
  server.close()
  await Promise.all([
    database.end(),
    ...(adminDatabase === database ? [] : [adminDatabase.end()]),
    ...(quarantineDatabase === database
      ? []
      : [quarantineDatabase.end()])
  ])
}

process.once('SIGTERM', () => void shutdown('SIGTERM'))
process.once('SIGINT', () => void shutdown('SIGINT'))
