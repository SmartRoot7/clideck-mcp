import { randomBytes } from 'node:crypto'

import { Hono } from 'hono'
import { vi } from 'vitest'

import type { Database } from '../src/db.js'
import {
  AdminNonceReplayGuard,
  createAdminActorSignature,
  requireSignedAdminActor,
  verifyAdminActorSignature,
  type AdminActorBindings,
  type AdminActorRole
} from '../src/http/admin-auth.js'
import { createApiApp } from '../src/http/api-app.js'
import { createLogger } from '../src/logger.js'
import { createMetrics } from '../src/metrics.js'
import { createTestConfig } from './helpers.js'

const actorId = '00000000-0000-4000-8000-000000000001'
const secret = '0123456789abcdef0123456789abcdef'

function signedHeaders(input: {
  method: 'GET' | 'POST'
  path: string
  body?: string
  role?: AdminActorRole
  timestamp?: string
  nonce?: string
}): Headers {
  const timestamp =
    input.timestamp ?? String(Math.floor(Date.now() / 1000))
  const nonce = input.nonce ?? randomBytes(16).toString('hex')
  const role = input.role ?? 'super_admin'
  const body = input.body ?? ''
  return new Headers({
    authorization: 'Bearer test-admin-token-that-is-at-least-32-characters',
    'content-type': input.method === 'POST' ? 'application/json' : '',
    'x-clideck-admin-actor': actorId,
    'x-clideck-admin-role': role,
    'x-clideck-admin-timestamp': timestamp,
    'x-clideck-admin-nonce': nonce,
    'x-clideck-admin-signature': createAdminActorSignature({
      secret,
      timestamp,
      nonce,
      method: input.method,
      pathWithQuery: input.path,
      body,
      actorId,
      role
    })
  })
}

function createAdminTestApp() {
  const config = createTestConfig({ adminActorHmacSecret: secret })
  const query = vi.fn(async (sqlValue: unknown, params?: unknown[]) => {
    const sql = String(sqlValue)
    if (sql.includes('rate_limit_buckets')) {
      return { rows: [{ request_count: 1 }] }
    }
    if (sql.includes('FROM expert_tasks') && !sql.includes('code_change')) {
      return {
        rows: [{
          public_id: 'ekt_abcdefghijklmnopqrstuvwxyzABCDEF',
          tenant_id: null,
          status: 'queued',
          priority: 0,
          attempts: 0,
          claim_owner: null,
          lease_until: null,
          expires_at: '2026-07-18T00:00:00.000Z',
          created_at: '2026-07-17T00:00:00.000Z',
          updated_at: '2026-07-17T00:00:00.000Z'
        }]
      }
    }
    if (sql.includes('FROM knowledge_conflicts')) {
      return {
        rows: [{
          id: '22222222-2222-4222-8222-222222222222',
          left_revision_id: '33333333-3333-4333-8333-333333333333',
          right_revision_id: '44444444-4444-4444-8444-444444444444',
          severity: 'medium',
          description: 'Conflicting version applicability',
          status: 'open',
          created_at: '2026-07-17T00:00:00.000Z',
          resolved_at: null
        }]
      }
    }
    if (sql.includes('FROM releases r') && !sql.includes('WITH switched AS')) {
      return {
        rows: [{
          id: '11111111-1111-4111-8111-111111111111',
          sequence: 2,
          status: 'published',
          reason: 'Validated release',
          created_by: 'worker',
          created_at: '2026-07-17T00:00:00.000Z',
          active: true,
          revision_count: 50
        }]
      }
    }
    if (sql.includes('FROM knowledge_revisions kr')) {
      return {
        rows: [{
          revision_id: '33333333-3333-4333-8333-333333333333',
          source: 'Cisco · Catalyst 9300 guide · 17.15 · https://example.test',
          created_at: '2026-07-17T00:00:00.000Z',
          status: 'validated'
        }]
      }
    }
    if (sql.includes('FROM code_change_approvals cca')) {
      return {
        rows: [{
          id: '55555555-5555-4555-8555-555555555555',
          task_id: 'ekt_abcdefghijklmnopqrstuvwxyzABCDEF',
          repository: 'SmartRoot7/clideck-mcp',
          summary: 'Safe documentation-only change',
          risk_assessment: 'No runtime behavior changes',
          status: 'approval_required',
          requested_by: 'researcher',
          decided_by: null,
          decision_reason: null,
          created_at: '2026-07-17T00:00:00.000Z',
          decided_at: null
        }]
      }
    }
    if (sql.includes('WITH switched AS')) {
      expect(params?.[1]).toBe(actorId)
      return {
        rows: [{
          id: '11111111-1111-4111-8111-111111111111',
          sequence: 2,
          status: 'published',
          reason: 'Validated release',
          created_by: 'worker',
          created_at: '2026-07-17T00:00:00.000Z',
          active: true,
          revision_count: 50
        }]
      }
    }
    throw new Error(`Unexpected query: ${sql.slice(0, 80)}`)
  })
  const database = { query } as unknown as Database
  return {
    app: createApiApp({
      config,
      database,
      adminDatabase: database,
      quarantineDatabase: database,
      logger: createLogger(config),
      metrics: createMetrics()
    }),
    query
  }
}

describe('admin actor signatures', () => {
  it('matches the website handoff test vector', () => {
    const body =
      '{"decision":"approved","reason":"Approved after manual review."}'
    expect(createAdminActorSignature({
      secret,
      timestamp: '1735689600',
      nonce: '00112233445566778899aabbccddeeff',
      method: 'POST',
      pathWithQuery:
        '/admin/v1/code-change-approvals/11111111-1111-4111-8111-111111111111/decision',
      body,
      actorId,
      role: 'super_admin'
    })).toBe(
      'v1=b1e46f67f339b410a84c6eaf1e49fe7e060b3d88b00cab7835574f0df6a84aa1'
    )
  })

  it('rejects expired and tampered signatures', () => {
    const headers = signedHeaders({
      method: 'GET',
      path: '/admin/v1/tasks',
      timestamp: '1735689600'
    })
    expect(verifyAdminActorSignature({
      headers,
      method: 'GET',
      pathWithQuery: '/admin/v1/tasks',
      body: '',
      secret,
      nowSeconds: 1_735_690_000
    }).valid).toBe(false)

    headers.set('x-clideck-admin-actor', 'not-a-user')
    expect(verifyAdminActorSignature({
      headers,
      method: 'GET',
      pathWithQuery: '/admin/v1/tasks',
      body: '',
      secret,
      nowSeconds: 1_735_689_600
    }).valid).toBe(false)
  })

  it('preserves a signed POST body and rejects nonce replay', async () => {
    const app = new Hono<AdminActorBindings>()
    const replayGuard = new AdminNonceReplayGuard()
    app.use('*', requireSignedAdminActor(
      secret,
      replayGuard,
      () => 1_735_689_600
    ))
    app.post('/admin/v1/test', async (context) =>
      context.json({
        actor: context.get('adminActor'),
        body: await context.req.json<unknown>()
      }))

    const body = '{"value":"safe"}'
    const timestamp = '1735689600'
    const nonce = '00112233445566778899aabbccddeeff'
    const headers = signedHeaders({
      method: 'POST',
      path: '/admin/v1/test',
      body,
      timestamp,
      nonce
    })
    const first = await app.request('/admin/v1/test', {
      method: 'POST',
      headers,
      body
    })
    expect(first.status).toBe(200)
    expect(await first.json()).toEqual({
      actor: { id: actorId, role: 'super_admin' },
      body: { value: 'safe' }
    })

    const replay = await app.request('/admin/v1/test', {
      method: 'POST',
      headers,
      body
    })
    expect(replay.status).toBe(401)
  })
})

describe('admin API website contract', () => {
  it('requires a signed actor and returns task arrays', async () => {
    const { app } = createAdminTestApp()
    const unsigned = await app.request('/admin/v1/tasks', {
      headers: {
        authorization:
          'Bearer test-admin-token-that-is-at-least-32-characters'
      }
    })
    expect(unsigned.status).toBe(401)

    const response = await app.request('/admin/v1/tasks', {
      headers: signedHeaders({
        method: 'GET',
        path: '/admin/v1/tasks',
        role: 'admin'
      })
    })
    expect(response.status).toBe(200)
    const payload = await response.json()
    expect(Array.isArray(payload)).toBe(true)
    expect(payload).toHaveLength(1)
  })

  it('enforces super-admin release activation and records the actor', async () => {
    const releaseId = '11111111-1111-4111-8111-111111111111'
    const path = `/admin/v1/releases/${releaseId}/activate`
    const body = '{}'

    const adminApp = createAdminTestApp().app
    const forbidden = await adminApp.request(path, {
      method: 'POST',
      headers: signedHeaders({
        method: 'POST',
        path,
        body,
        role: 'admin'
      }),
      body
    })
    expect(forbidden.status).toBe(403)

    const { app } = createAdminTestApp()
    const activated = await app.request(path, {
      method: 'POST',
      headers: signedHeaders({
        method: 'POST',
        path,
        body
      }),
      body
    })
    expect(activated.status).toBe(200)
    expect(await activated.json()).toMatchObject({
      id: releaseId,
      active: true,
      revision_count: 50
    })
  })

  it('returns bare arrays for every website list endpoint', async () => {
    const { app } = createAdminTestApp()
    for (const path of [
      '/admin/v1/tasks',
      '/admin/v1/conflicts',
      '/admin/v1/releases',
      '/admin/v1/code-change-approvals'
    ]) {
      const response = await app.request(path, {
        headers: signedHeaders({
          method: 'GET',
          path,
          role: 'admin'
        })
      })
      expect(response.status).toBe(200)
      expect(Array.isArray(await response.json())).toBe(true)
    }
  })

  it('limits provenance to a signed super-admin', async () => {
    const revisionId = '33333333-3333-4333-8333-333333333333'
    const path = `/admin/v1/revisions/${revisionId}/provenance`

    const adminApp = createAdminTestApp().app
    const forbidden = await adminApp.request(path, {
      headers: signedHeaders({
        method: 'GET',
        path,
        role: 'admin'
      })
    })
    expect(forbidden.status).toBe(403)

    const { app } = createAdminTestApp()
    const response = await app.request(path, {
      headers: signedHeaders({
        method: 'GET',
        path
      })
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      revision_id: revisionId,
      source:
        'Cisco · Catalyst 9300 guide · 17.15 · https://example.test',
      created_at: '2026-07-17T00:00:00.000Z',
      status: 'validated'
    })
  })
})
