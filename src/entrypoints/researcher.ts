import { serve } from '@hono/node-server'

import { getConfig, requireRuntimeSecret } from '../config.js'
import { createDatabase } from '../db.js'
import { createResearcherApp } from '../http/researcher-app.js'
import { createLogger } from '../logger.js'

const config = getConfig()
requireRuntimeSecret('RESEARCHER_TOKEN', config.researcherToken)
const logger = createLogger(config)
const database = createDatabase(config, logger, config.researcherDatabaseUrl)
const app = createResearcherApp({ config, database, logger })

const server = serve(
  {
    fetch: app.fetch,
    hostname: config.researcher.host,
    port: config.researcher.port,
    serverOptions: {
      requestTimeout: 35_000,
      headersTimeout: 10_000,
      keepAliveTimeout: 5_000
    }
  },
  (info) => {
    logger.info(
      { host: config.researcher.host, port: info.port },
      'CliDeck MCP researcher bridge started',
    )
  },
)
if ('maxRequestsPerSocket' in server) {
  server.maxRequestsPerSocket = 500
}

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'Shutting down researcher bridge')
  server.close()
  await database.end()
}

process.once('SIGTERM', () => void shutdown('SIGTERM'))
process.once('SIGINT', () => void shutdown('SIGINT'))
