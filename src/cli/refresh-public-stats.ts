import { refreshPublicStatsCache } from '../domain/telemetry.js'
import { createCliRuntime } from './runtime.js'

const { database, logger } = createCliRuntime('worker')

try {
  const stats = await refreshPublicStatsCache(database)
  logger.info(
    {
      releaseSequence: stats.active_release.sequence,
      publishedKnowledge: stats.coverage.published_knowledge
    },
    'Public stats cache refreshed',
  )
} finally {
  await database.end()
}
