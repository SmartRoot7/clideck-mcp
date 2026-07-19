import { readFile } from 'node:fs/promises'

import {
  labRevisionHash,
  verifyLabReport
} from '../domain/lab.js'
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
    const revision = await database.query<{
      revision_id: string
      stable_key: string
      kind: string
      version_min: string | null
      version_max: string | null
      title: string
      summary: string
      question_patterns: string[]
      cli_mode: string | null
      command_text: string | null
      procedure_steps: string[]
      prerequisites: string[]
      risks: string[]
      verification_steps: string[]
      rollback_steps: string[]
      limitations: string[]
      dangerous: boolean
    }>(
      `SELECT
         revision_id,
         stable_key,
         kind,
         version_min,
         version_max,
         title,
         summary,
         question_patterns,
         cli_mode,
         command_text,
         procedure_steps,
         prerequisites,
         risks,
         verification_steps,
         rollback_steps,
         limitations,
         dangerous
       FROM public_active_knowledge
       WHERE stable_key = $1`,
      [validation.stable_key],
    )
    const activeRevision = revision.rows[0]
    if (!activeRevision) throw new Error('LAB_VALIDATION_REVISION_NOT_ACTIVE')
    const revisionId = activeRevision.revision_id
    if (labRevisionHash(activeRevision) !== validation.revision_hash) {
      throw new Error('LAB_VALIDATION_REVISION_MISMATCH')
    }

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
