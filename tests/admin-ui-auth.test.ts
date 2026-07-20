import { randomUUID } from 'node:crypto'
import {
  mkdir,
  mkdtemp,
  rm,
  writeFile
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { createAdminUiApp } from '../src/http/admin-ui-app.js'
import { createApiApp } from '../src/http/api-app.js'
import {
  hashAdminPassword,
  LocalAdminSessionStore,
  LoginAttemptGuard,
  verifyAdminPassword
} from '../src/http/admin-ui-auth.js'
import { createLogger } from '../src/logger.js'
import { createMetrics } from '../src/metrics.js'
import type { Database } from '../src/db.js'
import { createTestConfig } from './helpers.js'

const origin = 'https://clideck-mcp.lan'
const host = 'clideck-mcp.lan'

async function testApp() {
  const base = createTestConfig()
  const config = createTestConfig({
    nodeEnv: 'production',
    adminUi: {
      ...base.adminUi,
      username: 'admin',
      passwordHash: await hashAdminPassword('A-strong-local-password-42!'),
      sessionSecret: 'local-session-secret-that-is-definitely-32-characters',
      actorId: randomUUID(),
      allowedOrigins: [origin],
      assetRoot: '/tmp/clideck-mcp-admin-ui-test-assets'
    }
  })
  const internalFetch = async (request: Request) => {
    const url = new URL(request.url)
    expect(request.headers.get('authorization')).toBe(
      `Bearer ${config.adminToken}`,
    )
    expect(request.headers.get('host')).toBe(
      `127.0.0.1:${config.api.port}`,
    )
    expect(request.headers.get('x-clideck-admin-role')).toBe('super_admin')
    if (request.method === 'POST') {
      return new Response(null, { status: 204 })
    }
    if (url.pathname === '/admin/v1/knowledge') {
      expect(url.search).toBe('')
      return Response.json({ items: [], total: 0, limit: 50, offset: 0 })
    }
    return Response.json(overviewFixture())
  }
  return createAdminUiApp({
    config,
    logger: createLogger(config),
    internalFetch
  })
}

async function login(app: Awaited<ReturnType<typeof testApp>>) {
  return app.request('/admin/auth/login', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin,
      host,
      'sec-fetch-site': 'same-origin'
    },
    body: JSON.stringify({
      username: 'admin',
      password: 'A-strong-local-password-42!'
    })
  })
}

describe('local admin password and session security', () => {
  it('uses scrypt hashes and rejects incorrect passwords', async () => {
    const hash = await hashAdminPassword('A-strong-local-password-42!')
    expect(hash).toMatch(/^scrypt-v1\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/)
    await expect(
      verifyAdminPassword('A-strong-local-password-42!', hash),
    ).resolves.toBe(true)
    await expect(verifyAdminPassword('wrong', hash)).resolves.toBe(false)
    await expect(verifyAdminPassword('value', 'not-a-hash')).resolves.toBe(false)
  })

  it('expires and revokes HMAC-indexed sessions', () => {
    const sessions = new LocalAdminSessionStore('x'.repeat(40), 1_000)
    const actor = {
      id: randomUUID(),
      username: 'admin',
      role: 'super_admin' as const
    }
    const created = sessions.create(actor, 10_000)
    expect(sessions.get(created.token, 10_999)?.actor).toEqual(actor)
    expect(sessions.get(created.token, 11_001)).toBeNull()
    const replacement = sessions.create(actor, 20_000)
    sessions.revoke(replacement.token)
    expect(sessions.get(replacement.token, 20_001)).toBeNull()
  })

  it('blocks repeated login failures in the configured window', () => {
    const guard = new LoginAttemptGuard(2, 1_000)
    expect(guard.allowed(10_000)).toBe(true)
    guard.recordFailure(10_000)
    guard.recordFailure(10_100)
    expect(guard.allowed(10_200)).toBe(false)
    expect(guard.allowed(11_101)).toBe(true)
  })
})

describe('local admin HTTP boundary', () => {
  it('serves one byte-identical frontend artifact to admin and demo', async () => {
    const assetRoot = await mkdtemp(join(tmpdir(), 'clideck-shared-ui-'))
    await mkdir(join(assetRoot, 'assets'))
    await writeFile(
      join(assetRoot, 'index.html'),
      '<!doctype html><script src="/_clideck-mcp-ui/assets/shared.js"></script>',
    )
    await writeFile(
      join(assetRoot, 'assets', 'shared.js'),
      'globalThis.__CLIDECK_SHARED_UI__ = true',
    )
    const base = createTestConfig()
    const config = createTestConfig({
      enablePublicDemo: true,
      adminUi: { ...base.adminUi, assetRoot }
    })
    const database = {
      query: async () => {
        throw new Error('Static frontend requests must not query PostgreSQL')
      }
    } as unknown as Database
    try {
      const admin = createAdminUiApp({
        config,
        logger: createLogger(config),
        internalFetch: async () =>
          new Response(null, { status: 500 })
      })
      const publicApi = createApiApp({
        config,
        database,
        adminDatabase: database,
        quarantineDatabase: database,
        logger: createLogger(config),
        metrics: createMetrics()
      })
      const [adminIndex, demoIndex, adminAsset, demoAsset] =
        await Promise.all([
          admin.request('/admin'),
          publicApi.request('/demo'),
          admin.request('/_clideck-mcp-ui/assets/shared.js'),
          publicApi.request('/_clideck-mcp-ui/assets/shared.js')
        ])
      expect([
        adminIndex.status,
        demoIndex.status,
        adminAsset.status,
        demoAsset.status
      ]).toEqual([200, 200, 200, 200])
      expect(await adminIndex.text()).toBe(await demoIndex.text())
      expect(await adminAsset.text()).toBe(await demoAsset.text())
      expect(adminAsset.headers.get('cache-control')).toContain('immutable')
      expect(demoAsset.headers.get('cache-control')).toContain('immutable')
    } finally {
      await rm(assetRoot, { recursive: true, force: true })
    }
  })

  it('requires a session and issues a strict secure host cookie', async () => {
    const app = await testApp()
    const unauthorized = await app.request('/admin/api/v1/overview', {
      headers: { host }
    })
    expect(unauthorized.status).toBe(401)

    const response = await login(app)
    expect(response.status).toBe(200)
    const cookie = response.headers.get('set-cookie') ?? ''
    expect(cookie).toContain('__Host-clideck_mcp_admin=')
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('Secure')
    expect(cookie).toContain('SameSite=Strict')
    expect(cookie).toContain('Path=/')

    const overview = await app.request('/admin/api/v1/overview', {
      headers: { host, cookie: cookie.split(';')[0]! }
    })
    expect(overview.status).toBe(200)
    expect(overview.headers.get('cache-control')).toBe('no-store')
    expect(await overview.json()).toMatchObject({
      active_release_sequence: 7,
      published_revisions: 56_798
    })

    const knowledge = await app.request('/admin/api/v1/knowledge', {
      headers: { host, cookie: cookie.split(';')[0]! }
    })
    expect(knowledge.status).toBe(200)
    expect(await knowledge.json()).toMatchObject({ items: [], total: 0 })

    const concurrency = await app.request(
      '/admin/api/v1/pipeline/concurrency',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin,
          host,
          cookie: cookie.split(';')[0]!,
          'sec-fetch-site': 'same-origin'
        },
        body: JSON.stringify({ max_concurrent_ai_runs: 3 })
      },
    )
    expect(concurrency.status).toBe(200)
    expect(await concurrency.json()).toMatchObject({
      ok: true,
      audit_target: 'pipeline'
    })
  })

  it('rejects cross-origin login and invalid host headers', async () => {
    const app = await testApp()
    const crossOrigin = await app.request('/admin/auth/login', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'https://attacker.example',
        host,
        'sec-fetch-site': 'cross-site'
      },
      body: JSON.stringify({ username: 'admin', password: 'ignored' })
    })
    expect(crossOrigin.status).toBe(403)
    const invalidHost = await app.request('/admin/api/v1/session', {
      headers: { host: 'attacker.example' }
    })
    expect(invalidHost.status).toBe(421)
  })

  it('removes the server-side session on logout', async () => {
    const app = await testApp()
    const response = await login(app)
    const cookie = response.headers.get('set-cookie')!.split(';')[0]!
    const logout = await app.request('/admin/auth/logout', {
      method: 'POST',
      headers: { origin, host, cookie, 'sec-fetch-site': 'same-origin' }
    })
    expect(logout.status).toBe(204)
    const session = await app.request('/admin/api/v1/session', {
      headers: { host, cookie }
    })
    expect(await session.json()).toMatchObject({ authenticated: false })
  })
})

function overviewFixture() {
  const now = new Date().toISOString()
  return {
    snapshot_at: now,
    active_release: randomUUID(),
    active_release_sequence: 7,
    active_release_created_at: now,
    published_revisions: 56_798,
    pipeline_enabled: true,
    ai_model: 'gpt-5.6-luna',
    reasoning_effort: 'low',
    max_concurrent_ai_runs: 3,
    max_active_sources: 4,
    max_deep_review_runs: 1,
    prepared_source_target: 8,
    prepared_sources: 8,
    control_generation: 4,
    pause_requested_at: null,
    paused_reason: null,
    pipeline_updated_at: now,
    active_source_id: null,
    active_source_count: 0,
    active_source_title: null,
    active_source_status: null,
    active_vendor: null,
    active_operating_system: null,
    active_document_role: null,
    queued_tasks: 0,
    open_conflicts: 0,
    feedback_24h: 0,
    sources_total: 1,
    sources_completed: 1,
    fragments_total: 20,
    candidates_total: 12,
    failures_24h: 0,
    completed_stages_24h: 42,
    tokens_total: 1_000,
    tokens_today: 100,
    active_agent_runs: 0,
    active_luna_executors: 0,
    queued_expert: 0,
    queued_verify: 0,
    queued_deep_review: 0,
    queued_analyze: 0,
    queued_discover: 0,
    tokens_per_revision: 5,
    projected_publications_per_day: 48,
    automatic_resolution_rate: 100,
    manual_exceptions_24h: 0,
    average_analysis_batch: 12,
    average_verification_batch: 32,
    executor_utilization: 88,
    discovery_unique_yield: 20,
    discovery_duplicates_avoided: 3,
    publication_failures_24h: 0,
    candidates_created_24h: 120,
    candidates_verified_24h: 100,
    candidates_deep_resolved_24h: 4,
    record_outcomes_24h: {
      rejected: 1,
      conflict: 2,
      quarantine: 3,
      exception: 0
    },
    pause_pending: false,
    published_records_24h: 2,
    deployed_commit_sha: 'a'.repeat(40),
    processes: [],
    executors: [],
    active_work: null,
    pipeline_funnel: [],
    source_intake: [],
    record_pipeline: [],
    breakdowns: {
      vendor: [],
      operating_system: [],
      risk: [],
      origin: []
    },
    activity_30d: [],
    published_hourly_24h: [],
    recent_errors: []
  }
}
