import {
  ENGINEERING_MEASUREMENT_SAMPLES
} from '@clideck/domain-engineering-measurements'

import { withTransaction } from '../db.js'
import {
  createDomainKnowledgeRevision
} from '../domain/domain-knowledge.js'
import { publishKnowledgeBatch } from '../domain/publication.js'
import { createCliRuntime } from './runtime.js'

const { database, logger } = createCliRuntime('worker')

try {
  const result = await withTransaction(database, async (client) => {
    const revisions = []
    for (const sample of ENGINEERING_MEASUREMENT_SAMPLES) {
      revisions.push(await createDomainKnowledgeRevision(
        client,
        'engineering-measurements',
        sample,
      ))
    }
    const created = revisions.filter((revision) => revision.created)
    if (created.length === 0) {
      return { created: 0, release: null }
    }
    const release = await publishKnowledgeBatch(
      client,
      revisions.map(({ itemId, revisionId }) => ({ itemId, revisionId })),
      'Published project-authored Engineering Measurements proof pack',
      'clideck-mcp-worker',
    )
    return { created: created.length, release }
  })
  logger.info(result, 'Engineering Measurements fixtures ready')
} catch (error) {
  logger.fatal({ err: error }, 'Engineering Measurements fixture seed failed')
  process.exitCode = 1
} finally {
  await database.end()
}
