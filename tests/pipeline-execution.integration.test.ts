import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { serve } from '@hono/node-server'
import pg from 'pg'
import { executionProtocolVersion, type ExecutionProfile } from '@clideck/admin-contracts'
import { createAdminActorSignature } from '../src/http/admin-auth.js'
import { createApiApp } from '../src/http/api-app.js'
import { createResearcherApp } from '../src/http/researcher-app.js'
import { createLogger } from '../src/logger.js'
import { createMetrics } from '../src/metrics.js'
import { claimPipelineTask, recordAgentRunResult } from '../src/domain/pipeline.js'
import {
  getExecutionSettings, getExecutionModels, publishExecutionCatalog, setExecutionSettings,
  refreshModelPricing, retryConfiguredModel, ensureFidelityExecutionProfile
} from '../src/domain/pipeline-execution.js'
import { pipelineExecutorIds } from '../src/domain/pipeline-runtime.js'
import { createTestConfig, integrationDatabaseUrl } from './helpers.js'

const suite = integrationDatabaseUrl ? describe : describe.skip
const profiles: ExecutionProfile[] = [
  { profile_id: 'luna', model: 'gpt-6-luna', reasoning_effort: 'low', fallback_model: null, fallback_reasoning_effort: null },
  { profile_id: 'luna_high', model: 'gpt-6.1-sol', reasoning_effort: 'high', fallback_model: null, fallback_reasoning_effort: null }
]

suite('configurable execution integration', () => {
  const database = new pg.Pool({ connectionString: integrationDatabaseUrl, max: 16 })
  const config = createTestConfig({ adminRateLimitPerMinute: 1000, enablePublicDemo: true })
  const logger = createLogger(config)
  const actor = { id: randomUUID(), role: 'super_admin' as const }
  let originalProfiles: ExecutionProfile[]
  let originalCapacity: number
  const taskIds: string[] = []

  beforeAll(async () => {
    const original = await getExecutionSettings(database)
    originalProfiles = original.profiles
    originalCapacity = original.max_concurrent_ai_runs
  })
  beforeEach(async () => {
    // This suite runs only against the disposable integration database.
    await database.query("UPDATE pipeline_tasks SET status = 'cancelled' WHERE status IN ('running', 'claimed', 'queued')")
    await database.query("UPDATE agent_runs SET status = 'cancelled', completed_at = now() WHERE status = 'running'")
    await database.query('DELETE FROM pipeline_model_circuits')
    await publishExecutionCatalog(database, {
      protocol_version: executionProtocolVersion, cli_version: 'codex-cli fixture', error: null,
      supports_structured_output: true, supports_web_research: true,
      models: ['gpt-6-luna', 'gpt-6.1-sol', 'gpt-5.6-luna', 'gpt-5.6-terra'].map((model) => ({
        model, display_name: model, description: '', reasoning_efforts: ['low', 'medium', 'high'], default_reasoning_effort: 'low'
      }))
    }, 'pipeline-pool')
    await database.query('UPDATE pipeline_settings SET enabled = true WHERE singleton')
  })
  afterAll(async () => {
    for (const profile of originalProfiles) await database.query(
      'UPDATE pipeline_execution_profiles SET model = $2, reasoning_effort = $3, fallback_model = $4, fallback_reasoning_effort = $5 WHERE profile_id = $1',
      [profile.profile_id, profile.model, profile.reasoning_effort, profile.fallback_model, profile.fallback_reasoning_effort],
    )
    await database.query('UPDATE pipeline_settings SET max_concurrent_ai_runs = $1 WHERE singleton', [originalCapacity])
    await database.query("UPDATE pipeline_tasks SET status = 'cancelled' WHERE id = ANY($1::uuid[]) AND status IN ('queued', 'claimed', 'running')", [taskIds])
    await database.query("UPDATE agent_runs SET status = 'cancelled', completed_at = now() WHERE pipeline_task_id = ANY($1::uuid[]) AND status = 'running'", [taskIds])
    await database.query('DELETE FROM pipeline_model_circuits')
    await database.end()
  })

  async function save(count: number, selected = profiles) {
    const current = await getExecutionSettings(database)
    return setExecutionSettings(database, { expected_version: current.settings_version, max_concurrent_ai_runs: count, profiles: selected }, actor)
  }
  async function queue(type = 'fragment_analysis', routing = 'low') {
    const id = randomUUID()
    await database.query(`INSERT INTO pipeline_tasks (id, task_type, stage, priority, dedupe_key, payload, requested_reasoning_effort)
      VALUES ($1::uuid, $2, $3, 200, ($1::uuid)::text, '{}'::jsonb, $4)`,
      [id, type, type === 'candidate_deep_review' ? 'deep_review' : 'analyze', routing])
    taskIds.push(id)
    return id
  }

  it('atomically saves independent profiles and preserves control generation, rollback aliases and audit', async () => {
    const before = (await database.query('SELECT * FROM pipeline_settings WHERE singleton')).rows[0]!
    const saved = await save(3)
    expect(saved.profiles).toEqual(profiles)
    const after = (await database.query('SELECT * FROM pipeline_settings WHERE singleton')).rows[0]!
    expect(after['settings_version']).toBe(before['settings_version'] + 1)
    expect(after['control_generation']).toBe(before['control_generation'])
    expect(after['ai_model']).toBe('gpt-5.6-luna')
    expect((await database.query("SELECT count(*)::int AS count FROM admin_audit_events WHERE actor_id = $1 AND action = 'pipeline.execution_settings'", [actor.id])).rows[0]?.['count']).toBeGreaterThan(0)
    await expect(setExecutionSettings(database, { expected_version: before['settings_version'], max_concurrent_ai_runs: 8, profiles }, actor)).rejects.toThrow('EXECUTION_SETTINGS_CONFLICT')
    const unsupported = profiles.map((profile) => ({ ...profile, model: 'gpt-unlisted' }))
    await expect(save(8, unsupported)).rejects.toThrow('EXECUTION_MODEL_UNSUPPORTED')
    expect((await getExecutionSettings(database)).max_concurrent_ai_runs).toBe(3)
  })

  it('allows capacity-only changes with a stale catalog and retains the last successful models on refresh failure', async () => {
    await save(3)
    await publishExecutionCatalog(database, {
      protocol_version: executionProtocolVersion, cli_version: 'codex-cli fixture', models: [], error: 'CODEX_CATALOG_UNAVAILABLE',
      supports_structured_output: true, supports_web_research: true
    }, 'pipeline-pool')
    const models = await getExecutionModels(database)
    expect(models.catalog.stale).toBe(true)
    expect(models.catalog.models).toHaveLength(4)
    expect((await save(2)).max_concurrent_ai_runs).toBe(2)
    await expect(save(2, profiles.map((profile) => ({ ...profile, reasoning_effort: 'medium' })))).rejects.toThrow('EXECUTION_CATALOG_STALE')
  })

  it('reserves exactly three of eight simultaneous claims and blocks disabled lanes', async () => {
    await save(3)
    for (let index = 0; index < 8; index++) await queue()
    const scheduler = await database.connect()
    let claims: Record<string, unknown>[]
    try {
      // The queue is already materialized. Keep unrelated maintenance from
      // locking these fixtures so this test measures simultaneous reservations.
      await scheduler.query('BEGIN')
      await scheduler.query("SELECT pg_advisory_xact_lock(hashtext('clideck-mcp:pipeline-scheduler'))")
      claims = await Promise.all(pipelineExecutorIds.map((id) => claimPipelineTask(database, config, id, `${id}:test`, executionProtocolVersion)))
    } finally { await scheduler.query('ROLLBACK'); scheduler.release() }
    expect(claims.filter((claim) => claim['pipeline_task_id'])).toHaveLength(3)
    expect(claims.slice(3).every((claim) => claim['pipeline_state'] === 'executor_disabled')).toBe(true)
    const snapshot = await database.query('SELECT model, reasoning_effort, execution_profile, settings_version FROM agent_runs WHERE pipeline_task_id = ANY($1::uuid[]) AND status = \'running\'', [taskIds])
    expect(snapshot.rows).toHaveLength(3)
    expect(snapshot.rows.every((run) => run['model'] === 'gpt-6-luna' && run['reasoning_effort'] === 'low' && run['execution_profile'] === 'luna')).toBe(true)
  })

  it('drains 8 to 2 without cancelling existing runs, keeps their models and permits immediate expansion', async () => {
    await save(8)
    for (let index = 0; index < 10; index++) await queue()
    const first = await Promise.all(pipelineExecutorIds.map((id) => claimPipelineTask(database, config, id, `${id}:drain`, 2)))
    // SKIP LOCKED can briefly yield to the concurrent maintenance transaction.
    // Retry only idle executors, just as normal standby polling does.
    for (let retry = 0; retry < 3 && first.some((claim) => !claim['pipeline_task_id']); retry++) {
      for (const [index, claim] of first.entries()) {
        if (!claim['pipeline_task_id']) first[index] = await claimPipelineTask(database, config, pipelineExecutorIds[index]!, 'test:drain-refill', 2)
      }
    }
    expect(first.filter((claim) => claim['pipeline_task_id'])).toHaveLength(8)
    const changed = profiles.map((profile) => ({ ...profile, model: 'gpt-6.1-sol', reasoning_effort: 'medium' as const }))
    await save(2, changed)
    expect((await getExecutionSettings(database)).draining_runs).toBe(6)
    expect((await claimPipelineTask(database, config, pipelineExecutorIds[0], 'test:lower', 2))['pipeline_state']).toBe('capacity_reached')
    expect((await database.query("SELECT count(*)::int AS count FROM agent_runs WHERE pipeline_task_id = ANY($1::uuid[]) AND status = 'running' AND model = 'gpt-6-luna'", [taskIds])).rows[0]?.['count']).toBe(8)
    for (const claim of first.slice(1)) {
      await database.query("UPDATE pipeline_tasks SET status = 'completed', completed_at = now() WHERE id = $1", [claim['pipeline_task_id']])
      await recordAgentRunResult(database, { agent_run_id: String(claim['agent_run_id']), status: 'completed', input_tokens: 0, cached_input_tokens: 0, output_tokens: 0, reasoning_output_tokens: 0, duration_ms: 1 })
    }
    const next = await claimPipelineTask(database, config, pipelineExecutorIds[1], 'test:new', 2)
    expect(next['requested_model']).toBe('gpt-6.1-sol')
    expect(next['requested_reasoning_effort']).toBe('medium')
    await save(8, changed)
    expect((await claimPipelineTask(database, config, pipelineExecutorIds[7], 'test:raise', 2))['pipeline_task_id']).toBeTruthy()
  })

  it('keeps advanced routing independent of reasoning and does not lease a new model to an old client', async () => {
    await save(8)
    await queue('candidate_deep_review', 'medium')
    expect((await claimPipelineTask(database, config, 'legacy-client'))['pipeline_state']).toBe('runtime_upgrade_required')
    const high = await claimPipelineTask(database, config, pipelineExecutorIds[0], 'test:high', 2)
    expect(high['execution_profile']).toBe('luna_high')
    expect(high['requested_model']).toBe('gpt-6.1-sol')
    expect(high['requested_reasoning_effort']).toBe('high')
  })

  it('isolates availability failures by model, effort, task and profile', async () => {
    await save(8)
    await queue()
    const failed = await claimPipelineTask(database, config, pipelineExecutorIds[0], 'test:fail', 2)
    await database.query("UPDATE pipeline_tasks SET status = 'failed' WHERE id = $1", [failed['pipeline_task_id']])
    await recordAgentRunResult(database, {
      agent_run_id: String(failed['agent_run_id']), status: 'failed', input_tokens: 0, cached_input_tokens: 0,
      output_tokens: 0, reasoning_output_tokens: 0, duration_ms: 1,
      diagnostic_code: 'CODEX_MODEL_UNAVAILABLE', diagnostic_fingerprint: `sha256:${'a'.repeat(64)}`
    })
    expect((await getExecutionModels(database)).circuits.some((circuit) => circuit['model'] === 'gpt-6-luna' && circuit['configuration_error'])).toBe(true)
    await save(8, profiles.map((profile) => ({ ...profile, model: 'gpt-6.1-sol' })))
    await queue()
    expect((await claimPipelineTask(database, config, pipelineExecutorIds[1], 'test:other', 2))['requested_model']).toBe('gpt-6.1-sol')
  })

  it('records an explicit fallback once and retries the configured primary with one probe', async () => {
    const fallback = profiles.map((profile) => profile.profile_id === 'luna'
      ? { ...profile, fallback_model: 'gpt-6.1-sol', fallback_reasoning_effort: 'high' as const } : profile)
    await save(3, fallback)
    const id = await queue()
    const first = await claimPipelineTask(database, config, pipelineExecutorIds[0], 'test:primary', 2)
    const fail = async (claim: Record<string, unknown>) => {
      await recordAgentRunResult(database, { agent_run_id: String(claim['agent_run_id']), status: 'failed',
        input_tokens: 0, cached_input_tokens: 0, output_tokens: 0, reasoning_output_tokens: 0, duration_ms: 1,
        diagnostic_code: 'CODEX_MODEL_UNAVAILABLE', diagnostic_fingerprint: `sha256:${'b'.repeat(64)}` })
      await database.query("UPDATE pipeline_tasks SET status = 'queued', claim_owner = NULL, lease_until = NULL WHERE id = $1", [id])
    }
    await fail(first)
    const second = await claimPipelineTask(database, config, pipelineExecutorIds[0], 'test:fallback', 2)
    expect(second).toMatchObject({ pipeline_task_id: id, requested_model: 'gpt-6.1-sol', requested_reasoning_effort: 'high', fallback_from_model: 'gpt-6-luna' })
    await fail(second)
    await expect(retryConfiguredModel(database, { profile_id: 'luna', model: 'gpt-unconfigured', reasoning_effort: 'low' }, actor)).rejects.toThrow('EXECUTION_MODEL_UNSUPPORTED')
    await retryConfiguredModel(database, { profile_id: 'luna', model: 'gpt-6-luna', reasoning_effort: 'low' }, actor)
    await queue()
    const probes = await Promise.all(pipelineExecutorIds.slice(0, 3).map((executor) => claimPipelineTask(database, config, executor, 'test:probe', 2)))
    expect(probes.filter((claim) => claim['task_type'] === 'fragment_analysis')).toHaveLength(1)
    expect(probes.find((claim) => claim['task_type'] === 'fragment_analysis')).toMatchObject({ requested_model: 'gpt-6-luna', fallback_from_model: null })
    expect((await database.query("SELECT count(*)::int AS count FROM admin_audit_events WHERE actor_id = $1 AND action = 'pipeline.model_retry'", [actor.id])).rows[0]?.['count']).toBe(1)
    await retryConfiguredModel(database, { profile_id: 'luna', model: 'gpt-6-luna', reasoning_effort: 'low' }, actor)
    expect((await database.query("SELECT probe_executor_id FROM pipeline_model_circuits WHERE execution_profile = 'luna' AND model = 'gpt-6-luna' AND task_type = 'fragment_analysis'")).rows[0]?.['probe_executor_id']).toBeTruthy()
  })

  it('caches dated official prices and retains them on an outage without repeated fetches', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(`#### Token rates
      <table><thead><tr><th>Credits per 1M tokens</th></tr></thead><tbody>
      <tr><td>GPT-6 Luna</td><td>2.5 credits</td><td>0.25 credits</td><td>12.5 credits</td></tr></tbody></table>`))
    try {
      await refreshModelPricing(database, true)
      const successful = (await getExecutionModels(database)).pricing
      expect(successful).toMatchObject({ unit: 'credits_per_million_tokens', error: null, stale: false })
      expect(successful.updated_at).toBeTruthy()
      expect(successful.prices).toEqual([{ model: 'gpt-6-luna', display_name: 'GPT-6 Luna', input: 2.5, cached_input: 0.25, output: 12.5 }])
      await refreshModelPricing(database)
      expect(fetcher).toHaveBeenCalledTimes(1)
      expect(fetcher.mock.calls[0]?.[0]).toBe('https://learn.chatgpt.com/docs/pricing.md')
      fetcher.mockRejectedValue(new Error('network unavailable'))
      await refreshModelPricing(database, true)
      const failed = (await getExecutionModels(database)).pricing
      expect(failed).toMatchObject({ prices: successful.prices, updated_at: successful.updated_at, stale: true, error: 'PRICING_REFRESH_FAILED' })
    } finally { fetcher.mockRestore() }
  })

  it('supports settings, scoped retries and new Fidelity profiles with the production admin role', async () => {
    const admin = new pg.Pool({ connectionString: integrationDatabaseUrl, options: '-c role=clideck_mcp_admin' })
    try {
      const current = await getExecutionSettings(admin)
      await setExecutionSettings(admin, { expected_version: current.settings_version, max_concurrent_ai_runs: 1, profiles }, actor)
      await database.query(`INSERT INTO pipeline_model_circuits (
        execution_profile, task_type, model, reasoning_effort, diagnostic_fingerprint, open_until, configuration_error
      ) VALUES ('luna', 'fragment_analysis', 'gpt-6-luna', 'low', $1, now() + interval '1 day', true)`, [`sha256:${'c'.repeat(64)}`])
      await retryConfiguredModel(admin, { profile_id: 'luna', model: 'gpt-6-luna', reasoning_effort: 'low' }, actor)
      const client = await admin.connect()
      try { expect(await ensureFidelityExecutionProfile(client, `admin-role-${randomUUID()}`, 'gpt-6-luna')).toHaveProperty('id') }
      finally { client.release() }
      expect((await getExecutionModels(admin)).catalog.models.length).toBe(4)
    } finally { await admin.end() }
  })

  it('requires super-admin authorization and keeps model settings read-only in the demo', async () => {
    const api = createApiApp({ config, database, adminDatabase: database, quarantineDatabase: database, logger, metrics: createMetrics() })
    const path = '/admin/v1/pipeline/settings'
    const current = await getExecutionSettings(database)
    const body = JSON.stringify({ expected_version: current.settings_version, max_concurrent_ai_runs: 3, profiles })
    expect((await api.request(path, { method: 'POST', body })).status).toBe(401)
    const timestamp = String(Math.floor(Date.now() / 1000)), nonce = randomUUID().replaceAll('-', '')
    expect((await api.request(path, { method: 'POST', body, headers: {
      authorization: `Bearer ${config.adminToken}`, 'content-type': 'application/json',
      'x-clideck-admin-actor': actor.id, 'x-clideck-admin-role': 'admin',
      'x-clideck-admin-timestamp': timestamp, 'x-clideck-admin-nonce': nonce,
      'x-clideck-admin-signature': createAdminActorSignature({ secret: config.adminActorHmacSecret, timestamp, nonce,
        method: 'POST', pathWithQuery: path, body, actorId: actor.id, role: 'admin' })
    } })).status).toBe(403)
    expect((await api.request('/public/v1/demo/pipeline/settings')).status).toBe(200)
    expect((await api.request('/public/v1/demo/pipeline/settings', { method: 'POST', body })).status).toBe(405)
    expect((await getExecutionSettings(database)).settings_version).toBe(current.settings_version)
  })

  it('sends the model selected by the admin API through the real bridge/coordinator to a Codex subprocess', async () => {
    const api = createApiApp({ config, database, adminDatabase: database, quarantineDatabase: database, logger, metrics: createMetrics() })
    const current = await getExecutionSettings(database)
    const body = JSON.stringify({ expected_version: current.settings_version, max_concurrent_ai_runs: 1, profiles })
    const path = '/admin/v1/pipeline/settings'
    const timestamp = String(Math.floor(Date.now() / 1000)), nonce = randomUUID().replaceAll('-', '')
    const response = await api.request(path, { method: 'POST', body, headers: {
      authorization: `Bearer ${config.adminToken}`, 'content-type': 'application/json',
      'x-clideck-admin-actor': actor.id, 'x-clideck-admin-role': actor.role,
      'x-clideck-admin-timestamp': timestamp, 'x-clideck-admin-nonce': nonce,
      'x-clideck-admin-signature': createAdminActorSignature({ secret: config.adminActorHmacSecret, timestamp, nonce,
        method: 'POST', pathWithQuery: path, body, actorId: actor.id, role: actor.role })
    } })
    expect(response.status).toBe(200)
    await queue()
    const directory = await mkdtemp(join(tmpdir(), 'clideck-execution-e2e-'))
    await mkdir(join(directory, '.secrets'))
    await writeFile(join(directory, '.secrets/researcher-bridge.env'), 'CLIDECK_RESEARCHER_TOKEN=test-token-at-least-32-characters\n', { mode: 0o600 })
    const capture = join(directory, 'argv.json'), binary = join(directory, 'codex')
    await writeFile(binary, `#!${process.execPath}\nrequire('node:fs').writeFileSync(${JSON.stringify(capture)}, JSON.stringify(process.argv.slice(2)));\nprocess.exit(0);\n`, { mode: 0o700 })
    const app = createResearcherApp({ config, database, logger })
    const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 })
    await new Promise<void>((done) => server.once('listening', done))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing test bridge address')
    try {
      const child = spawn(process.execPath, ['--import', resolve('node_modules/tsx/dist/loader.mjs'), resolve('src/cli/pipeline-coordinator.ts')], {
        cwd: directory, env: { ...process.env,
          CLIDECK_RESEARCHER_URL: `http://127.0.0.1:${address.port}/mcp`, CLIDECK_RESEARCHER_TOKEN: config.researcherToken,
          CLIDECK_PIPELINE_EXECUTOR_ID: pipelineExecutorIds[0], CLIDECK_RESEARCHER_INSTANCE_ID: 'pipeline-executor-01:e2e',
          CLIDECK_PIPELINE_CODEX_BINARY: binary, CLIDECK_PIPELINE_ONCE: 'true' }, stdio: 'ignore'
      })
      await new Promise<void>((done, reject) => {
        const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Coordinator test timed out')) }, 20000)
        child.once('error', reject)
        child.once('exit', (code) => { clearTimeout(timer); code === 0 ? done() : reject(new Error(`Coordinator exited ${code}`)) })
      })
      const args = JSON.parse(await readFile(capture, 'utf8')) as string[]
      expect(args[args.indexOf('-m') + 1]).toBe('gpt-6-luna')
      expect(args).toContain('model_reasoning_effort="low"')
      expect(args[args.indexOf('--sandbox') + 1]).toBe('read-only')
      expect(args).toContain('--ignore-user-config')
    } finally {
      await new Promise<void>((done) => server.close(() => done()))
      await rm(directory, { recursive: true, force: true })
    }
  }, 30000)
})
