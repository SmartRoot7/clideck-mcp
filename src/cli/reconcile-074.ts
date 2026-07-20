import { withTransaction } from '../db.js'
import { createCliRuntime } from './runtime.js'

const reconciliationKey = 'clideck-mcp-0.7.4-quarantine'
const { database, logger } = createCliRuntime('worker')

try {
  const result = await withTransaction(database, async (client) => {
    await client.query(
      `INSERT INTO pipeline_reconciliation_snapshots (
         reconciliation_key,
         candidate_id,
         previous_status,
         previous_resolution_code,
         previous_resolution_reason,
         previous_resolution_attempts,
         previous_next_review_at
       )
       SELECT
         $1,
         id,
         status,
         resolution_code,
         resolution_reason,
         resolution_attempts,
         next_review_at
       FROM knowledge_candidates
       WHERE status = 'quarantined'
       ON CONFLICT (reconciliation_key, candidate_id) DO NOTHING`,
      [reconciliationKey],
    )
    const updated = await client.query<{
      resolution_code: string
      count: number
    }>(
      `WITH reconciled AS (
         UPDATE knowledge_candidates
            SET status = 'deep_review',
                deep_review_task_id = NULL,
                verification_task_id = NULL,
                publication_task_id = NULL,
                next_review_at = now(),
                deep_review_batch_limit = CASE
                  WHEN resolution_code IN (
                    'deep_reviewer_omitted',
                    'deep_process_failure'
                  ) THEN 1
                  WHEN resolution_code = 'publication_preflight' THEN 5
                  ELSE least(deep_review_batch_limit, 10)
                END,
                technical_retry_count = CASE
                  WHEN resolution_code IN (
                    'deep_reviewer_omitted',
                    'deep_process_failure'
                  ) THEN least(20, technical_retry_count + 1)
                  ELSE technical_retry_count
                END,
                last_technical_failure_code = CASE
                  WHEN resolution_code IN (
                    'deep_reviewer_omitted',
                    'deep_process_failure'
                  ) THEN resolution_code
                  ELSE last_technical_failure_code
                END,
                resolution_code = concat(
                  'reconcile_',
                  coalesce(resolution_code, 'legacy_unclassified')
                ),
                resolution_reason = concat(
                  'CliDeck MCP 0.7.4 automatic reconciliation: ',
                  coalesce(
                    resolution_reason,
                    'legacy quarantine without a classified reason'
                  )
                ),
                updated_at = now()
          WHERE status = 'quarantined'
          RETURNING resolution_code
       )
       SELECT resolution_code, count(*)::int AS count
       FROM reconciled
       GROUP BY resolution_code
       ORDER BY resolution_code`,
    )
    return updated.rows
  })
  logger.info(
    { reconciliationKey, outcomes: result },
    'Quarantined candidates returned to automatic deep review',
  )
} finally {
  await database.end()
}
