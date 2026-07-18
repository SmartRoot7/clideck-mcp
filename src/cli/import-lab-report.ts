import { readFile } from 'node:fs/promises'

import { verifyLabReport } from '../domain/lab.js'
import { createCliRuntime } from './runtime.js'

const [reportPath] = process.argv.slice(2)
const expectedCommit =
  process.env['DEPLOY_COMMIT_SHA'] ?? process.env['COMMIT_SHA']
if (!reportPath || !expectedCommit) {
  throw new Error(
    'Usage: DEPLOY_COMMIT_SHA=<40-hex> pnpm lab:import-report <report.json>',
  )
}

const report = verifyLabReport(
  JSON.parse(await readFile(reportPath, 'utf8')),
)
if (report.commit_sha !== expectedCommit) {
  throw new Error('LAB_REPORT_COMMIT_MISMATCH')
}
if (report.checks.some((check) => check.status !== 'passed')) {
  throw new Error('LAB_REPORT_CONTAINS_FAILED_CHECKS')
}

const { database, logger } = createCliRuntime('worker')
let imported = 0
try {
  await database.query('BEGIN')
  for (const validation of report.validations) {
    if (validation.status !== 'passed') continue
    const revision = await database.query<{ revision_id: string }>(
      `SELECT revision_id
       FROM public_active_knowledge
       WHERE stable_key = $1`,
      [validation.stable_key],
    )
    const revisionId = revision.rows[0]?.revision_id
    if (!revisionId) throw new Error('LAB_VALIDATION_REVISION_NOT_ACTIVE')

    await database.query(
      `INSERT INTO knowledge_validations (
         revision_id, validation_type, status, fixture_key, tool_version,
         report_hash, commit_sha, summary, internal_report,
         executed_at, expires_at
       )
       VALUES ($1, $2, 'passed', $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (
         revision_id, validation_type, fixture_key, report_hash
       ) DO NOTHING`,
      [
        revisionId,
        validation.validation_type,
        validation.fixture_key,
        validation.tool_version,
        report.report_hash,
        report.commit_sha,
        validation.summary,
        validation.details,
        validation.executed_at,
        validation.expires_at
      ],
    )
    await database.query(
      `UPDATE knowledge_public_trust
       SET
         validation_level = CASE
           WHEN $2 = 'runtime_lab_validated'
             THEN 'runtime_lab_validated'
           WHEN $2 = 'batfish_modeled'
             AND validation_level = 'documentation_reviewed'
             THEN 'batfish_modeled'
           ELSE validation_level
         END,
         lab_validated_at = $3
       WHERE revision_id = $1`,
      [revisionId, validation.validation_type, validation.executed_at],
    )
    imported += 1
  }
  await database.query('COMMIT')
  logger.info(
    {
      imported,
      commitSha: report.commit_sha,
      reportHash: report.report_hash
    },
    'Lab validation report imported',
  )
} catch (error) {
  await database.query('ROLLBACK')
  throw error
} finally {
  await database.end()
}
