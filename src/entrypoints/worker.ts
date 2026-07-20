import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'

import { getConfig } from '../config.js'
import { createDatabase } from '../db.js'
import {
  processNextCandidate,
  runWorkerMaintenance
} from '../domain/publication.js'
import {
  processNextPipelineTask,
  purgeExpiredSourceArtifacts
} from '../domain/pipeline-worker.js'
import { purgeExpiredMcpRequestLogs } from '../domain/mcp-observability.js'
import { refreshPublicStatsCacheIfStale } from '../domain/telemetry.js'
import { createLogger } from '../logger.js'

const config = getConfig()
const logger = createLogger(config)
const database = createDatabase(config, logger, config.workerDatabaseUrl)
const instanceId = `worker-${randomUUID()}`
const abortController = new AbortController()
let nextRequestLogCleanupAt = 0

process.once('SIGTERM', () => abortController.abort())
process.once('SIGINT', () => abortController.abort())

logger.info({ instanceId }, 'CliDeck MCP worker started')

try {
  while (!abortController.signal.aborted) {
    await runWorkerMaintenance(database, instanceId)
    await refreshPublicStatsCacheIfStale(database)
    await purgeExpiredSourceArtifacts(database, logger)
    if (Date.now() >= nextRequestLogCleanupAt) {
      await purgeExpiredMcpRequestLogs(
        database,
        config.mcpRequestLogRetentionDays,
      )
      nextRequestLogCleanupAt = Date.now() + 60 * 60_000
    }
    const processedPipeline = await processNextPipelineTask(
      database,
      config,
      logger,
      instanceId,
    )
    const processedExpert = processedPipeline
      ? false
      : await processNextCandidate(database, config, logger)
    const processed = processedPipeline || processedExpert
    if (!processed) {
      try {
        await delay(config.workerPollMs, undefined, {
          signal: abortController.signal
        })
      } catch {
        // Expected when the process receives a shutdown signal.
      }
    }
  }
} catch (error) {
  logger.fatal({ err: error, instanceId }, 'Worker stopped unexpectedly')
  process.exitCode = 1
} finally {
  await database.end()
  logger.info({ instanceId }, 'CliDeck MCP worker stopped')
}
