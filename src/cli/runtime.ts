import { getConfig } from '../config.js'
import { createDatabase } from '../db.js'
import { createLogger } from '../logger.js'

export function createCliRuntime(
  databaseRole: 'default' | 'admin' | 'worker' = 'default',
) {
  const config = getConfig()
  const logger = createLogger(config)
  const databaseUrl =
    databaseRole === 'admin'
      ? config.adminDatabaseUrl
      : databaseRole === 'worker'
        ? config.workerDatabaseUrl
        : config.databaseUrl
  const database = createDatabase(config, logger, databaseUrl)
  return { config, logger, database }
}
