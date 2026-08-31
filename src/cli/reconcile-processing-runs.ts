import { reconcileTerminalProcessingRuns } from '../domain/intake.js'
import { createCliRuntime } from './runtime.js'

const { database, logger } = createCliRuntime('worker')

try {
  const reconciled = await reconcileTerminalProcessingRuns(database)
  logger.info({ reconciled }, 'Terminal processing runs reconciled')
} finally {
  await database.end()
}
