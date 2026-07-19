import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { serveStatic } from '@hono/node-server/serve-static'
import {
  activeSourceDetailSchema,
  agentRunsSchema,
  approvalsSchema,
  conflictsSchema,
  coverageTargetsSchema,
  expertTasksSchema,
  feedbackRowsSchema,
  importRunsSchema,
  knowledgePageSchema,
  labSchema,
  loginInputSchema,
  mutationAckSchema,
  overviewSchema,
  pipelineDetailsSchema,
  provenanceSchema,
  qualitySchema,
  releasesSchema,
  sessionSchema,
  sourcesSchema
} from '@clideck/admin-contracts'
import { Hono, type Context } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { createMiddleware } from 'hono/factory'
import { secureHeaders } from 'hono/secure-headers'
import { timeout } from 'hono/timeout'
import { z, type ZodType } from 'zod'

import type { AppConfig } from '../config.js'
import type { Logger } from '../logger.js'
import { createAdminActorSignature } from './admin-auth.js'
import {
  LocalAdminSessionStore,
  LoginAttemptGuard,
  type LocalAdminActor,
  verifyAdminPassword
} from './admin-ui-auth.js'

const PRODUCTION_COOKIE = '__Host-clideck_mcp_admin'
const DEVELOPMENT_COOKIE = 'clideck_mcp_admin'
const UUID_SCHEMA = z.uuid()
const EXPERT_TASK_ID = /^ekt_[A-Za-z0-9_-]{32}$/

type InternalFetch = (request: Request) => Promise<Response>

type AdminUiDependencies = {
  config: AppConfig
  logger: Logger
  internalFetch: InternalFetch
}

type AdminUiBindings = {
  Variables: {
    localAdminActor: LocalAdminActor
    localAdminSessionToken: string
  }
}

type ForwardResult =
  | { ok: true; value: unknown }
  | { ok: false; status: 400 | 401 | 403 | 404 | 409 | 429 | 500 | 502 }

function safeStatus(
  status: number,
): Extract<ForwardResult, { ok: false }>['status'] {
  if (
    status === 400 ||
    status === 401 ||
    status === 403 ||
    status === 404 ||
    status === 409 ||
    status === 429
  ) {
    return status
  }
  return status >= 500 ? 502 : 500
}

function iso(expiresAt: number): string {
  return new Date(expiresAt).toISOString()
}

function normalizeAllowedHosts(config: AppConfig): Set<string> {
  const hosts = new Set<string>([
    `${config.adminUi.host}:${config.adminUi.port}`.toLowerCase(),
    `127.0.0.1:${config.adminUi.port}`,
    `localhost:${config.adminUi.port}`
  ])
  for (const origin of config.adminUi.allowedOrigins) {
    try {
      hosts.add(new URL(origin).host.toLowerCase())
    } catch {
      // Config validation in the entrypoint reports malformed origins.
    }
  }
  return hosts
}

export function createAdminUiApp(dependencies: AdminUiDependencies) {
  const { config, logger, internalFetch } = dependencies
  const app = new Hono<AdminUiBindings>()
  const cookieName =
    config.nodeEnv === 'production' ? PRODUCTION_COOKIE : DEVELOPMENT_COOKIE
  const sessions = new LocalAdminSessionStore(
    config.adminUi.sessionSecret,
    config.adminUi.sessionHours * 60 * 60_000,
  )
  const loginGuard = new LoginAttemptGuard()
  const allowedOrigins = new Set(config.adminUi.allowedOrigins)
  const allowedHosts = normalizeAllowedHosts(config)
  const actor: LocalAdminActor = {
    id: config.adminUi.actorId,
    username: config.adminUi.username,
    role: 'super_admin'
  }
  const assetRoot = resolve(config.adminUi.assetRoot)
  const indexPath = resolve(assetRoot, 'index.html')

  app.use(
    '*',
    secureHeaders({
      contentSecurityPolicy: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        connectSrc: ["'self'"],
        fontSrc: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        imgSrc: ["'self'", 'data:'],
        objectSrc: ["'none'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"]
      },
      crossOriginEmbedderPolicy: false,
      strictTransportSecurity:
        config.nodeEnv === 'production'
          ? 'max-age=31536000'
          : false,
      xFrameOptions: 'DENY'
    }),
  )
  app.use(
    '*',
    bodyLimit({
      maxSize: 64 * 1_024,
      onError: (context) =>
        context.json({ error: 'request_body_too_large' }, 413)
    }),
  )
  app.use('*', timeout(30_000))
  app.use('*', async (context, next) => {
    const host = context.req.header('host')?.toLowerCase()
    if (config.nodeEnv === 'production' && (!host || !allowedHosts.has(host))) {
      return context.json({ error: 'invalid_host' }, 421)
    }
    const startedAt = performance.now()
    await next()
    context.header(
      'cache-control',
      context.req.path.startsWith('/admin/assets/')
        ? 'public, max-age=31536000, immutable'
        : 'no-store',
    )
    logger.info(
      {
        method: context.req.method,
        path: context.req.path,
        status: context.res.status,
        durationMs: Math.round((performance.now() - startedAt) * 100) / 100
      },
      'Local admin request',
    )
  })

  const requireSameOrigin = createMiddleware<AdminUiBindings>(
    async (context, next) => {
      if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(context.req.method)) {
        await next()
        return
      }
      const origin = context.req.header('origin')
      const fetchSite = context.req.header('sec-fetch-site')
      if (
        (config.nodeEnv === 'production' &&
          (!origin || !allowedOrigins.has(origin))) ||
        (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none')
      ) {
        return context.json({ error: 'invalid_origin' }, 403)
      }
      await next()
    },
  )
  app.use('/admin/auth/*', requireSameOrigin)
  app.use('/admin/api/*', requireSameOrigin)

  app.get('/admin/health', (context) => context.json({
    status: 'ok',
    service: 'clideck-mcp-admin',
    version: '0.5.0'
  }))

  function sessionFor(context: {
    req: { raw: Request }
  }): ReturnType<LocalAdminSessionStore['get']> {
    const headers = context.req.raw.headers
    const cookieHeader = headers.get('cookie') ?? ''
    const cookie = cookieHeader
      .split(';')
      .map((entry) => entry.trim())
      .find((entry) => entry.startsWith(`${cookieName}=`))
    const token = cookie?.slice(cookieName.length + 1)
    return sessions.get(token ? decodeURIComponent(token) : undefined)
  }

  const requireSession = createMiddleware<AdminUiBindings>(
    async (context, next) => {
      const token = getCookie(context, cookieName)
      const session = sessions.get(token)
      if (!session) return context.json({ error: 'authentication_required' }, 401)
      context.set('localAdminActor', session.actor)
      context.set('localAdminSessionToken', token ?? '')
      await next()
    },
  )

  async function forward(
    method: 'GET' | 'POST',
    pathWithQuery: string,
    actorId: string,
    bodyValue?: unknown,
  ): Promise<ForwardResult> {
    const body = bodyValue === undefined ? '' : JSON.stringify(bodyValue)
    const timestamp = String(Math.floor(Date.now() / 1_000))
    const nonce = randomBytes(16).toString('hex')
    const signature = createAdminActorSignature({
      secret: config.adminActorHmacSecret,
      timestamp,
      nonce,
      method,
      pathWithQuery,
      body,
      actorId,
      role: 'super_admin'
    })
    const response = await internalFetch(new Request(
      `http://127.0.0.1:${config.api.port}${pathWithQuery}`,
      {
        method,
        headers: {
          authorization: `Bearer ${config.adminToken}`,
          // Hono's in-memory fetch adapter does not synthesize Host from the
          // Request URL. Production request policy requires an explicit,
          // allowlisted loopback host.
          host: `127.0.0.1:${config.api.port}`,
          ...(body ? { 'content-type': 'application/json' } : {}),
          'x-clideck-admin-actor': actorId,
          'x-clideck-admin-role': 'super_admin',
          'x-clideck-admin-timestamp': timestamp,
          'x-clideck-admin-nonce': nonce,
          'x-clideck-admin-signature': signature
        },
        ...(body ? { body } : {})
      },
    ))
    if (!response.ok) {
      return { ok: false, status: safeStatus(response.status) }
    }
    if (method === 'POST' || response.status === 204) {
      return { ok: true, value: null }
    }
    try {
      return { ok: true, value: await response.json() }
    } catch {
      return { ok: false, status: 502 }
    }
  }

  async function readEndpoint(
    context: Context<AdminUiBindings>,
    path: string,
    schema: ZodType,
  ) {
    const result = await forward(
      'GET',
      path,
      context.get('localAdminActor').id,
    )
    if (!result.ok) {
      return context.json({ error: 'admin_backend_unavailable' }, result.status)
    }
    const parsed = schema.safeParse(result.value)
    if (!parsed.success) {
      logger.error(
        {
          path,
          issues: parsed.error.issues.map((issue) => ({
            path: issue.path.join('.'),
            code: issue.code
          }))
        },
        'Local admin response contract mismatch',
      )
      return context.json({ error: 'invalid_admin_response' }, 502)
    }
    return context.json(parsed.data)
  }

  async function mutationEndpoint(
    context: Context<AdminUiBindings>,
    path: string,
    body: unknown,
    message: string,
    auditTarget: string | null,
  ) {
    const result = await forward(
      'POST',
      path,
      context.get('localAdminActor').id,
      body,
    )
    if (!result.ok) {
      return context.json({ error: 'admin_action_failed' }, result.status)
    }
    return context.json(mutationAckSchema.parse({
      ok: true,
      message,
      audit_target: auditTarget
    }))
  }

  app.get('/admin/api/v1/session', (context) => {
    const session = sessionFor(context)
    return context.json(sessionSchema.parse({
      authenticated: Boolean(session),
      actor: session?.actor ?? null,
      expires_at: session ? iso(session.expiresAt) : null
    }))
  })

  app.post('/admin/auth/login', async (context) => {
    if (!loginGuard.allowed()) {
      return context.json({ error: 'too_many_login_attempts' }, 429)
    }
    const parsed = loginInputSchema.safeParse(await context.req.json<unknown>())
    if (
      !parsed.success ||
      parsed.data.username !== config.adminUi.username ||
      !(await verifyAdminPassword(
        parsed.success ? parsed.data.password : '',
        config.adminUi.passwordHash,
      ))
    ) {
      loginGuard.recordFailure()
      return context.json({ error: 'invalid_credentials' }, 401)
    }
    loginGuard.reset()
    const session = sessions.create(actor)
    setCookie(context, cookieName, session.token, {
      path: '/',
      secure: config.nodeEnv === 'production',
      httpOnly: true,
      sameSite: 'Strict',
      maxAge: config.adminUi.sessionHours * 60 * 60
    })
    return context.json(sessionSchema.parse({
      authenticated: true,
      actor,
      expires_at: iso(session.expiresAt)
    }))
  })

  app.post('/admin/auth/logout', (context) => {
    const token = getCookie(context, cookieName)
    sessions.revoke(token)
    deleteCookie(context, cookieName, {
      path: '/',
      secure: config.nodeEnv === 'production',
      httpOnly: true,
      sameSite: 'Strict'
    })
    return context.body(null, 204)
  })

  app.use('/admin/api/v1/*', requireSession)

  app.get('/admin/api/v1/overview', (context) =>
    readEndpoint(context, '/admin/v1/overview', overviewSchema),
  )
  app.get('/admin/api/v1/coverage', (context) =>
    readEndpoint(context, '/admin/v1/coverage', coverageTargetsSchema),
  )
  app.get('/admin/api/v1/sources', (context) => {
    const query = new URLSearchParams()
    const status = context.req.query('status')
    const limit = context.req.query('limit')
    if (status) query.set('status', status.slice(0, 64))
    if (limit && /^\d{1,3}$/.test(limit)) query.set('limit', limit)
    const suffix = query.size ? `?${query.toString()}` : ''
    return readEndpoint(
      context,
      `/admin/v1/sources${suffix}`,
      sourcesSchema,
    )
  })
  app.get('/admin/api/v1/pipeline', (context) =>
    readEndpoint(context, '/admin/v1/pipeline', pipelineDetailsSchema),
  )
  app.get('/admin/api/v1/active-source', (context) =>
    readEndpoint(
      context,
      '/admin/v1/active-source',
      activeSourceDetailSchema,
    ),
  )
  app.get('/admin/api/v1/knowledge', (context) => {
    const query = new URLSearchParams()
    for (const name of [
      'q',
      'vendor',
      'operating_system',
      'kind',
      'risk',
      'origin'
    ]) {
      const value = context.req.query(name)
      if (value) query.set(name, value.slice(0, 256))
    }
    for (const name of ['limit', 'offset']) {
      const value = context.req.query(name)
      if (value && /^\d{1,6}$/.test(value)) query.set(name, value)
    }
    const suffix = query.size ? `?${query.toString()}` : ''
    return readEndpoint(
      context,
      `/admin/v1/knowledge${suffix}`,
      knowledgePageSchema,
    )
  })
  app.get('/admin/api/v1/imports', (context) =>
    readEndpoint(context, '/admin/v1/imports', importRunsSchema),
  )
  app.get('/admin/api/v1/agent-runs', (context) => {
    const limit = context.req.query('limit')
    const suffix = limit && /^\d{1,3}$/.test(limit)
      ? `?limit=${limit}`
      : ''
    return readEndpoint(
      context,
      `/admin/v1/agent-runs${suffix}`,
      agentRunsSchema,
    )
  })
  app.get('/admin/api/v1/tasks', (context) =>
    readEndpoint(context, '/admin/v1/tasks', expertTasksSchema),
  )
  app.get('/admin/api/v1/quality', (context) =>
    readEndpoint(context, '/admin/v1/quality', qualitySchema),
  )
  app.get('/admin/api/v1/lab', (context) =>
    readEndpoint(context, '/admin/v1/lab', labSchema),
  )
  app.get('/admin/api/v1/conflicts', (context) =>
    readEndpoint(context, '/admin/v1/conflicts', conflictsSchema),
  )
  app.get('/admin/api/v1/releases', (context) =>
    readEndpoint(context, '/admin/v1/releases', releasesSchema),
  )
  app.get('/admin/api/v1/feedback', (context) =>
    readEndpoint(context, '/admin/v1/feedback', feedbackRowsSchema),
  )
  app.get('/admin/api/v1/approvals', (context) =>
    readEndpoint(
      context,
      '/admin/v1/code-change-approvals',
      approvalsSchema,
    ),
  )
  app.get('/admin/api/v1/revisions/:revisionId/provenance', async (context) => {
    const revisionId = context.req.param('revisionId')
    if (!UUID_SCHEMA.safeParse(revisionId).success) {
      return context.json({ error: 'invalid_revision_id' }, 400)
    }
    return readEndpoint(
      context,
      `/admin/v1/revisions/${revisionId}/provenance`,
      provenanceSchema,
    )
  })

  app.post('/admin/api/v1/pipeline/state', async (context) => {
    const parsed = z.object({
      enabled: z.boolean(),
      reason: z.string().trim().min(5).max(2_000).optional()
    }).strict().safeParse(await context.req.json<unknown>())
    if (!parsed.success) return context.json({ error: 'invalid_input' }, 400)
    return mutationEndpoint(
      context,
      '/admin/v1/pipeline/state',
      parsed.data,
      parsed.data.enabled ? 'Pipeline resumed.' : 'All Luna executors paused.',
      'pipeline',
    )
  })
  app.post('/admin/api/v1/pipeline/concurrency', async (context) => {
    const parsed = z.object({
      max_concurrent_ai_runs: z.number().int().min(1).max(4)
    }).strict().safeParse(await context.req.json<unknown>())
    if (!parsed.success) return context.json({ error: 'invalid_input' }, 400)
    return mutationEndpoint(
      context,
      '/admin/v1/pipeline/concurrency',
      parsed.data,
      `Luna concurrency changed to ${parsed.data.max_concurrent_ai_runs}.`,
      'pipeline',
    )
  })
  app.post('/admin/api/v1/coverage/:targetId/priority', async (context) => {
    const targetId = context.req.param('targetId')
    const parsed = z.object({
      priority: z.number().int().min(-100).max(100)
    }).strict().safeParse(await context.req.json<unknown>())
    if (!UUID_SCHEMA.safeParse(targetId).success || !parsed.success) {
      return context.json({ error: 'invalid_input' }, 400)
    }
    return mutationEndpoint(
      context,
      `/admin/v1/coverage/${targetId}/priority`,
      parsed.data,
      `Coverage priority changed to ${parsed.data.priority}.`,
      targetId,
    )
  })
  app.post('/admin/api/v1/sources/:sourceId/action', async (context) => {
    const sourceId = context.req.param('sourceId')
    const parsed = z.object({
      action: z.enum(['retry', 'skip', 'reject']),
      reason: z.string().trim().min(5).max(2_000)
    }).strict().safeParse(await context.req.json<unknown>())
    if (!UUID_SCHEMA.safeParse(sourceId).success || !parsed.success) {
      return context.json({ error: 'invalid_input' }, 400)
    }
    return mutationEndpoint(
      context,
      `/admin/v1/sources/${sourceId}/action`,
      parsed.data,
      `Source ${parsed.data.action} accepted.`,
      sourceId,
    )
  })
  app.post('/admin/api/v1/pipeline/discover', async (context) => {
    const parsed = z.object({
      coverage_target_id: z.uuid().nullable()
    }).strict().safeParse(await context.req.json<unknown>())
    if (!parsed.success) return context.json({ error: 'invalid_input' }, 400)
    return mutationEndpoint(
      context,
      '/admin/v1/pipeline/discover',
      parsed.data,
      'Source discovery queued.',
      parsed.data.coverage_target_id,
    )
  })
  app.post('/admin/api/v1/tasks/:taskId/action', async (context) => {
    const taskId = context.req.param('taskId')
    const parsed = z.object({
      action: z.enum(['requeue', 'cancel']),
      reason: z.string().trim().min(5).max(2_000)
    }).strict().safeParse(await context.req.json<unknown>())
    if (!EXPERT_TASK_ID.test(taskId) || !parsed.success) {
      return context.json({ error: 'invalid_input' }, 400)
    }
    return mutationEndpoint(
      context,
      `/admin/v1/tasks/${taskId}/action`,
      parsed.data,
      `Expert task ${parsed.data.action} accepted.`,
      taskId,
    )
  })
  app.post('/admin/api/v1/conflicts/:conflictId/decision', async (context) => {
    const conflictId = context.req.param('conflictId')
    const parsed = z.object({
      decision: z.enum(['resolved', 'accepted']),
      reason: z.string().trim().min(5).max(2_000)
    }).strict().safeParse(await context.req.json<unknown>())
    if (!UUID_SCHEMA.safeParse(conflictId).success || !parsed.success) {
      return context.json({ error: 'invalid_input' }, 400)
    }
    return mutationEndpoint(
      context,
      `/admin/v1/conflicts/${conflictId}/decision`,
      parsed.data,
      `Conflict marked ${parsed.data.decision}.`,
      conflictId,
    )
  })
  app.post('/admin/api/v1/releases/:releaseId/activate', async (context) => {
    const releaseId = context.req.param('releaseId')
    const parsed = z.object({
      reason: z.string().trim().min(5).max(2_000)
    }).strict().safeParse(await context.req.json<unknown>())
    if (!UUID_SCHEMA.safeParse(releaseId).success || !parsed.success) {
      return context.json({ error: 'invalid_input' }, 400)
    }
    return mutationEndpoint(
      context,
      `/admin/v1/releases/${releaseId}/activate`,
      parsed.data,
      'Knowledge release activated.',
      releaseId,
    )
  })
  app.post('/admin/api/v1/approvals/:approvalId/decision', async (context) => {
    const approvalId = context.req.param('approvalId')
    const parsed = z.object({
      decision: z.enum(['approved', 'rejected']),
      reason: z.string().trim().min(5).max(2_000)
    }).strict().safeParse(await context.req.json<unknown>())
    if (!UUID_SCHEMA.safeParse(approvalId).success || !parsed.success) {
      return context.json({ error: 'invalid_input' }, 400)
    }
    return mutationEndpoint(
      context,
      `/admin/v1/code-change-approvals/${approvalId}/decision`,
      parsed.data,
      `Code change ${parsed.data.decision}.`,
      approvalId,
    )
  })

  app.all('/admin/api/*', (context) =>
    context.json({ error: 'not_found' }, 404),
  )
  app.all('/admin/auth/*', (context) =>
    context.json({ error: 'not_found' }, 404),
  )

  if (existsSync(assetRoot)) {
    app.use(
      '/admin/assets/*',
      serveStatic({
        root: assetRoot,
        rewriteRequestPath: (path) => path.replace(/^\/admin/, ''),
        onFound: (_path, context) => {
          context.header('cache-control', 'public, max-age=31536000, immutable')
        }
      }),
    )
  }

  const serveIndex = async (context: Context<AdminUiBindings>) => {
    try {
      const html = await readFile(indexPath, 'utf8')
      return context.html(html)
    } catch {
      return context.json({ error: 'admin_ui_not_built' }, 503)
    }
  }
  app.get('/', (context) => context.redirect('/admin'))
  app.get('/admin', serveIndex)
  app.get('/admin/*', serveIndex)

  app.notFound((context) => context.json({ error: 'not_found' }, 404))
  app.onError((error, context) => {
    logger.error(
      { err: error, path: context.req.path },
      'Unhandled local admin error',
    )
    return context.json({ error: 'internal_error' }, 500)
  })
  return app
}
