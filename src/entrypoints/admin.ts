import { serve } from '@hono/node-server'

import { getConfig, requireRuntimeSecret } from '../config.js'
import { createDatabase } from '../db.js'
import { createAdminUiApp } from '../http/admin-ui-app.js'
import { createApiApp } from '../http/api-app.js'
import { createLogger } from '../logger.js'
import { createMetrics } from '../metrics.js'

const config = getConfig()
requireRuntimeSecret('ADMIN_TOKEN', config.adminToken)
requireRuntimeSecret(
  'CLIDECK_MCP_ADMIN_ACTOR_HMAC_SECRET',
  config.adminActorHmacSecret,
)
requireRuntimeSecret('ADMIN_UI_SESSION_SECRET', config.adminUi.sessionSecret)
if (!config.adminUi.passwordHash.startsWith('scrypt-v1$')) {
  throw new Error(
    'ADMIN_UI_PASSWORD_HASH must be configured by pnpm admin:setup',
  )
}
if (!config.adminUi.actorId) {
  throw new Error('ADMIN_UI_ACTOR_ID must be configured by pnpm admin:setup')
}
for (const origin of config.adminUi.allowedOrigins) {
  const parsed = new URL(origin)
  if (
    config.nodeEnv === 'production' &&
    parsed.protocol !== 'https:'
  ) {
    throw new Error('Production ADMIN_UI_ALLOWED_ORIGINS must use HTTPS')
  }
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
const internalApi = createApiApp({
  config,
  database,
  adminDatabase,
  quarantineDatabase,
  logger,
  metrics,
  exposeAdminRoutes: true
})
const app = createAdminUiApp({
  config,
  logger,
  internalFetch: async (request) => internalApi.fetch(request)
})

const server = serve(
  {
    fetch: app.fetch,
    hostname: config.adminUi.host,
    port: config.adminUi.port,
    serverOptions: {
      requestTimeout: 35_000,
      headersTimeout: 10_000,
      keepAliveTimeout: 5_000
    }
  },
  (info) => {
    logger.info(
      { host: config.adminUi.host, port: info.port },
      'CliDeck MCP local admin started',
    )
  },
)

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'Shutting down local admin')
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
