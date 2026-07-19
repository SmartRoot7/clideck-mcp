import { readFile, writeFile } from 'node:fs/promises'

import {
  finalizeLabReport,
  labRevisionHash
} from '../domain/lab.js'
import { IOS_XE_SEED_KNOWLEDGE } from '../seed-data/ios-xe-knowledge.js'

const [batfishPath, runtimePath, outputPath] = process.argv.slice(2)
const commitSha = process.env['COMMIT_SHA'] ?? process.env['GITHUB_SHA']
if (!batfishPath || !runtimePath || !outputPath || !commitSha) {
  throw new Error(
    'Usage: COMMIT_SHA=<40-hex> pnpm lab:build-report <batfish.json> <runtime.json> <report.json>',
  )
}

const batfish = JSON.parse(await readFile(batfishPath, 'utf8')) as {
  validations?: unknown[]
  checks?: unknown[]
}
const runtime = JSON.parse(await readFile(runtimePath, 'utf8')) as unknown
const seedKnowledge = new Map(
  IOS_XE_SEED_KNOWLEDGE.map((record) => [
    record.stableKey,
    record
  ]),
)
const validations = (batfish.validations ?? []).map((unparsed) => {
  if (!unparsed || typeof unparsed !== 'object' || Array.isArray(unparsed)) {
    return unparsed
  }
  const validation = unparsed as Record<string, unknown>
  const stableKey = validation['stable_key']
  const record = typeof stableKey === 'string'
    ? seedKnowledge.get(stableKey)
    : undefined
  if (!record) throw new Error('LAB_VALIDATION_SEED_BINDING_NOT_FOUND')
  return {
    ...validation,
    revision_hash: labRevisionHash({
      stable_key: record.stableKey,
      kind: record.kind,
      version_min: record.versionMin,
      version_max: record.versionMax ?? null,
      title: record.title,
      summary: record.summary,
      question_patterns: record.questionPatterns,
      cli_mode: record.cliMode ?? null,
      command_text: record.command ?? null,
      procedure_steps: record.procedure,
      prerequisites: record.prerequisites,
      risks: record.risks,
      verification_steps: record.verification,
      rollback_steps: record.rollback,
      limitations: record.limitations,
      dangerous: record.dangerous
    })
  }
})
const report = finalizeLabReport({
  schema_version: 1,
  commit_sha: commitSha,
  generated_at: new Date().toISOString(),
  validations,
  checks: [...(batfish.checks ?? []), runtime]
})
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
