import {
  getPublicStats,
  refreshPublicStatsCacheIfStale
} from '../domain/telemetry.js'
import { createCliRuntime } from './runtime.js'

const { database, logger } = createCliRuntime('worker')

try {
  // A release must not fail only because an expensive aggregate refresh lost a
  // transient database race. `refreshPublicStatsCacheIfStale` retains the last
  // valid snapshot and marks it stale; it still throws when no safe snapshot
  // exists at all.
  const refreshed = await refreshPublicStatsCacheIfStale(database)
  const stats = await getPublicStats(database)
  logger.info(
    {
      releaseSequence: stats.active_release.sequence,
      publishedKnowledge: stats.coverage.published_knowledge,
      refreshed,
      stale: stats.cache.stale
    },
    'Public stats cache refreshed',
  )
} finally {
  await database.end()
}
