import { activateKnowledgeRelease } from '../domain/publication.js'
import { createCliRuntime } from './runtime.js'

const releaseId = process.argv[2]
if (!releaseId) throw new Error('release id is required')

const { database, logger } = createCliRuntime('worker')
try {
  const result = await activateKnowledgeRelease(
    database,
    releaseId,
    'production-deploy-rollback',
  )
  logger.info(
    { releaseId: result.id, sequence: result.sequence },
    'Knowledge release activated',
  )
} finally {
  await database.end()
}
