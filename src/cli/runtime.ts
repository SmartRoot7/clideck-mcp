import { getConfig } from '../config.js'
import { createDatabase } from '../db.js'
import { createLogger } from '../logger.js'

export function createCliRuntime() {
  const config = getConfig()
  const logger = createLogger(config)
  const database = createDatabase(config, logger)
  return { config, logger, database }
}
