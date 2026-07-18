import { readFile, writeFile } from 'node:fs/promises'

import { finalizeLabReport } from '../domain/lab.js'

const [batfishPath, runtimePath, outputPath] = process.argv.slice(2)
const commitSha = process.env['GITHUB_SHA'] ?? process.env['COMMIT_SHA']
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
const report = finalizeLabReport({
  schema_version: 1,
  commit_sha: commitSha,
  generated_at: new Date().toISOString(),
  validations: batfish.validations ?? [],
  checks: [...(batfish.checks ?? []), runtime]
})
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
