import { performance } from 'node:perf_hooks'

import { resolveNetworkContext } from '../domain/context.js'
import { searchKnowledge } from '../domain/knowledge.js'
import { evalCases } from '../evals/cases.js'
import { createCliRuntime } from './runtime.js'

const forbiddenPublicKeys = [
  'canonical_url',
  'source',
  'source_id',
  'source_url',
  'document',
  'manual',
  'evidence',
  'content_hash',
  'pipeline'
]

const { database, logger } = createCliRuntime()
const durations: number[] = []
const failures: Array<{ id: string; reason: string }> = []

try {
  for (const testCase of evalCases) {
    const startedAt = performance.now()
    const context = await resolveNetworkContext(database, testCase.context)
    const answers = await searchKnowledge(
      database,
      testCase.question,
      context,
      3,
      testCase.category === 'workflow' ? 'workflow' : undefined,
    )
    durations.push(performance.now() - startedAt)

    if ((answers.length > 0) !== testCase.expectedKnown) {
      failures.push({
        id: testCase.id,
        reason: `expectedKnown=${testCase.expectedKnown}, answers=${answers.length}`
      })
    }
    const serialized = JSON.stringify(answers).toLowerCase()
    const leakedKey = forbiddenPublicKeys.find((key) =>
      new RegExp(`"${key}"\\s*:`).test(serialized),
    )
    if (leakedKey) {
      failures.push({
        id: testCase.id,
        reason: `forbidden public field: ${leakedKey}`
      })
    }
  }

  const ordered = [...durations].sort((left, right) => left - right)
  const p95 = ordered[Math.ceil(ordered.length * 0.95) - 1] ?? 0
  const report = {
    cases: evalCases.length,
    passed: evalCases.length - new Set(failures.map((failure) => failure.id)).size,
    failures,
    latency_ms: {
      p50: Number((ordered[49] ?? 0).toFixed(2)),
      p95: Number(p95.toFixed(2)),
      max: Number((ordered.at(-1) ?? 0).toFixed(2))
    },
    target_p95_ms: 300
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  if (failures.length > 0 || p95 > 300) process.exitCode = 1
} catch (error) {
  logger.fatal({ err: error }, 'Eval failed')
  process.exitCode = 1
} finally {
  await database.end()
}
