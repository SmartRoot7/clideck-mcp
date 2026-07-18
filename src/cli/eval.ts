import { performance } from 'node:perf_hooks'

import { sha256Label } from '../crypto.js'
import { reviewNetworkChange, verifyNetworkChange } from '../domain/change.js'
import { resolveNetworkContext } from '../domain/context.js'
import { searchKnowledge } from '../domain/knowledge.js'
import { analyzeDeviceSnapshot } from '../domain/snapshot.js'
import { analyzeNetworkPath } from '../domain/topology.js'
import { adviseNetworkUpgrade } from '../domain/upgrade.js'
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

const { config, database, logger } = createCliRuntime('admin')
const durations: number[] = []
const failures: Array<{ id: string; reason: string }> = []

function fail(id: string, reason: string) {
  failures.push({ id, reason })
}

try {
  for (const testCase of evalCases) {
    const startedAt = performance.now()
    if (testCase.type === 'knowledge') {
      const context = await resolveNetworkContext(database, testCase.context)
      const answers = await searchKnowledge(
        database,
        testCase.question,
        context,
        3,
      )
      if ((answers.length > 0) !== testCase.expected_known) {
        fail(
          testCase.id,
          `expectedKnown=${testCase.expected_known}, answers=${answers.length}`,
        )
      }
      const serialized = JSON.stringify(answers).toLowerCase()
      const leakedKey = forbiddenPublicKeys.find((key) =>
        new RegExp(`"${key}"\\s*:`).test(serialized),
      )
      if (leakedKey) fail(testCase.id, `forbidden public field: ${leakedKey}`)
    } else if (testCase.type === 'snapshot') {
      const result = analyzeDeviceSnapshot({
        snapshot: testCase.snapshot,
        snapshot_type: 'auto',
        redaction_profile: 'strict'
      })
      if (result.context?.vendor !== testCase.expected_vendor) {
        fail(testCase.id, `unexpected vendor: ${result.context?.vendor}`)
      }
      if (
        testCase.sentinel &&
        result.sanitized_snapshot.includes(testCase.sentinel)
      ) {
        fail(testCase.id, 'sentinel secret survived redaction')
      }
    } else if (testCase.type === 'change') {
      const result = reviewNetworkChange(config, {
        intent: 'Evaluate a bounded network change',
        context: {
          vendor: 'Cisco',
          model: 'C9300',
          operating_system: 'IOS XE',
          version: '17.9.4'
        },
        commands: testCase.commands
      })
      if (result.decision !== testCase.expected_decision) {
        fail(testCase.id, `unexpected decision: ${result.decision}`)
      }
      if (
        result.decision === 'blocked' &&
        result.verification_token !== null
      ) {
        fail(testCase.id, 'blocked change received a verification token')
      }
    } else if (testCase.type === 'verification') {
      const review = reviewNetworkChange(config, {
        intent: 'Evaluate deterministic post-change verification',
        context: {
          vendor: 'Cisco',
          model: 'C9300',
          operating_system: 'IOS XE',
          version: '17.9.4'
        },
        commands: testCase.commands
      })
      if (!review.verification_token) {
        fail(testCase.id, 'review did not issue a verification token')
      } else {
        const result = verifyNetworkChange(config, {
          verification_token: review.verification_token,
          before_snapshot: testCase.before_snapshot,
          after_snapshot: testCase.after_snapshot
        })
        if (result.result !== testCase.expected_result) {
          fail(testCase.id, `unexpected verification: ${result.result}`)
        }
        if (
          result.result !== 'passed' &&
          result.next_action.includes('successful')
        ) {
          fail(testCase.id, 'non-passing result used success language')
        }
      }
    } else if (testCase.type === 'upgrade') {
      const result = adviseNetworkUpgrade({
        model: testCase.model,
        operating_system:
          testCase.model.startsWith('EX')
            ? 'Junos'
            : testCase.model.startsWith('DCS')
              ? 'EOS'
              : 'IOS XE',
        current_version: testCase.current_version,
        target_version: testCase.target_version,
        enabled_features: ['HTTPS Web UI']
      })
      if (result.status !== testCase.expected_status) {
        fail(testCase.id, `unexpected upgrade status: ${result.status}`)
      }
    } else {
      const result = analyzeNetworkPath({
        snapshots: [{
          device_hint: 'source-device',
          output_type: testCase.output_type,
          content: testCase.content
        }],
        source: 'source-device',
        destination: 'destination'
      })
      if (result.nodes.length < testCase.minimum_nodes) {
        fail(testCase.id, `only ${result.nodes.length} nodes parsed`)
      }
      if (
        testCase.expected_complete !== undefined &&
        result.paths[0]?.complete !== testCase.expected_complete
      ) {
        fail(testCase.id, `unexpected path completeness`)
      }
    }
    durations.push(performance.now() - startedAt)
  }

  const ordered = [...durations].sort((left, right) => left - right)
  const percentile = (fraction: number) =>
    ordered[Math.max(0, Math.ceil(ordered.length * fraction) - 1)] ?? 0
  const p95 = percentile(0.95)
  const failedCaseCount = new Set(
    failures.map((failure) => failure.id),
  ).size
  const report = {
    suite: 'clideck-mcp-product-eval',
    generated_at: new Date().toISOString(),
    cases: evalCases.length,
    passed: evalCases.length - failedCaseCount,
    failed: failedCaseCount,
    dangerous_false_safe: failures.filter((failure) =>
      failure.id.startsWith('change-critical'),
    ).length,
    failures,
    latency_ms: {
      p50: Number(percentile(0.5).toFixed(2)),
      p95: Number(p95.toFixed(2)),
      max: Number((ordered.at(-1) ?? 0).toFixed(2))
    },
    target_p95_ms: 300
  }
  const commitSha =
    process.env['GITHUB_SHA'] ?? process.env['DEPLOY_COMMIT_SHA'] ?? null
  await database.query(
    `INSERT INTO product_eval_runs (
       suite, commit_sha, report_hash, case_count, passed_count,
       failed_count, dangerous_false_safe, p50_ms, p95_ms, max_ms,
       executed_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     ON CONFLICT (report_hash) DO NOTHING`,
    [
      report.suite,
      commitSha && /^[0-9a-f]{40}$/.test(commitSha) ? commitSha : null,
      sha256Label(JSON.stringify(report)),
      report.cases,
      report.passed,
      report.failed,
      report.dangerous_false_safe,
      report.latency_ms.p50,
      report.latency_ms.p95,
      report.latency_ms.max,
      report.generated_at
    ],
  )
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  if (failures.length > 0 || p95 > 300) process.exitCode = 1
} catch (error) {
  logger.fatal({ err: error }, 'Eval failed')
  process.exitCode = 1
} finally {
  await database.end()
}
