import { randomUUID } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import { createAdminUiApp } from '../src/http/admin-ui-app.js'
import {
  hashAdminPassword,
  LocalAdminSessionStore,
  LoginAttemptGuard,
  verifyAdminPassword
} from '../src/http/admin-ui-auth.js'
import { createLogger } from '../src/logger.js'
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
    expect(request.headers.get('authorization')).toBe(
      `Bearer ${config.adminToken}`,
    )
    expect(request.headers.get('host')).toBe(
      `127.0.0.1:${config.api.port}`,
    )
    expect(request.headers.get('x-clideck-admin-role')).toBe('super_admin')
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
    active_release: randomUUID(),
    active_release_sequence: 7,
    active_release_created_at: now,
    published_revisions: 56_798,
    pipeline_enabled: true,
    ai_model: 'gpt-5.6-luna',
    reasoning_effort: 'low',
    max_concurrent_ai_runs: 3,
    control_generation: 4,
    pause_requested_at: null,
    paused_reason: null,
    pipeline_updated_at: now,
    active_source_id: null,
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
    queued_analyze: 0,
    queued_discover: 0,
    tokens_per_revision: 5,
    pause_pending: false,
    published_records_24h: 2,
    deployed_commit_sha: 'a'.repeat(40),
    processes: [],
    active_work: null,
    pipeline_funnel: [],
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
