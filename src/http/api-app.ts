import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { serveStatic } from '@hono/node-server/serve-static'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { Hono, type Context } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { secureHeaders } from 'hono/secure-headers'
import { timeout } from 'hono/timeout'
import { z } from 'zod'

import type { AppConfig } from '../config.js'
import { constantTimeTokenEquals } from '../crypto.js'
import type { Database } from '../db.js'
import { resolvePublicActor } from '../domain/auth.js'
import {
  actOnExpertTask,
  actOnSource,
  decideConflict,
  forceDiscovery,
  getActiveSource,
  getAdminOverview,
  getPipelineDetails,
  getQualityDashboard,
  listAgentRuns,
  listCoverageTargets,
  listFeedback,
  listImports,
  listKnowledge,
  listLabValidations,
  listSources,
  recordAdminAudit,
  setPipelineConcurrency,
  setPipelineEnabled,
  updateCoveragePriority
} from '../domain/admin.js'
import {
  reviewNetworkChange,
  verifyNetworkChange
} from '../domain/change.js'
import { resolveNetworkContext } from '../domain/context.js'
import { getPublicDemoSnapshot } from '../domain/demo.js'
import { searchKnowledge } from '../domain/knowledge.js'
import {
  changeReviewInputSchema,
  changeVerificationInputSchema,
  feedbackInputSchema,
  networkPathInputSchema,
  queryKnowledgeInputSchema,
  requestExpertAnswerInputSchema,
  snapshotAnalysisInputSchema,
  taskCredentialsSchema,
  upgradeAdvisorInputSchema
} from '../domain/schemas.js'
import { analyzeDeviceSnapshot } from '../domain/snapshot.js'
import {
  getPublicStats,
  recordPublicUsage
} from '../domain/telemetry.js'
import {
  createExpertTask,
  getExpertTask,
  submitFeedback
} from '../domain/tasks.js'
import { analyzeNetworkPath } from '../domain/topology.js'
import { adviseNetworkUpgrade } from '../domain/upgrade.js'
import type { Logger } from '../logger.js'
import type { Metrics } from '../metrics.js'
import { createPublicMcpServer } from '../mcp/public-server.js'
import { PostgresTaskStore } from '../mcp/postgres-task-store.js'
import {
  requireSignedAdminActor,
  type AdminActor
} from './admin-auth.js'
import {
  consumeDailyRateLimit,
  consumeRateLimit,
  getClientAddress,
  requestPolicy,
  requireStaticBearer
} from './security.js'

export type ApiDependencies = {
  config: AppConfig
  database: Database
  adminDatabase: Database
  quarantineDatabase: Database
  logger: Logger
  metrics: Metrics
  exposeAdminRoutes?: boolean
}

type ApiBindings = {
  Variables: {
    requestId: string
    adminActor: AdminActor
  }
}

export function createApiApp(dependencies: ApiDependencies) {
  const {
    config,
    database,
    adminDatabase,
    quarantineDatabase,
    logger,
    metrics
  } = dependencies
  const app = new Hono<ApiBindings>()

  app.use('*', secureHeaders())
  app.use('*', requestPolicy(config))
  app.use(
    '*',
    bodyLimit({
      maxSize: config.maxRequestBytes,
      onError: (context) =>
        context.json({ error: 'request_body_too_large' }, 413)
    }),
  )
  app.use('*', timeout(30_000))
  app.use('*', async (context, next) => {
    const requestId = context.req.header('x-request-id') ?? randomUUID()
    context.set('requestId', requestId)
    context.header('x-request-id', requestId)
    const startedAt = performance.now()
    await next()
    metrics.httpRequests.inc({
      process: 'api',
      route: context.req.path,
      method: context.req.method,
      status: String(context.res.status)
    })
    logger.info(
      {
        requestId,
        method: context.req.method,
        path: context.req.path,
        status: context.res.status,
        durationMs: Math.round((performance.now() - startedAt) * 100) / 100
      },
      'HTTP request',
    )
  })

  app.get('/health', (context) =>
    context.json({
      status: 'ok',
      service: 'CliDeck MCP — Network Knowledge',
      version: '0.6.0'
    }),
  )

  app.get('/ready', async (context) => {
    try {
      const result = await database.query<{ active: boolean }>(
        `SELECT EXISTS (
           SELECT 1 FROM active_release
         ) AS active`,
      )
      if (!result.rows[0]?.active) {
        return context.json(
          { status: 'not_ready', reason: 'no_active_release' },
          503,
        )
      }
      return context.json({ status: 'ready' })
    } catch {
      return context.json(
        { status: 'not_ready', reason: 'database_unavailable' },
        503,
      )
    }
  })

  app.get('/metrics', async (context) => {
    const authorization = context.req.header('authorization')
    const token = authorization?.startsWith('Bearer ')
      ? authorization.slice('Bearer '.length)
      : ''
    if (!token || !constantTimeTokenEquals(token, config.adminToken)) {
      return context.json({ error: 'unauthorized' }, 401)
    }
    context.header('content-type', metrics.registry.contentType)
    return context.body(await metrics.registry.metrics())
  })

  app.all('/mcp', async (context) => {
    const clientAddress = getClientAddress(context, config)
    const rate = await consumeRateLimit(
      database,
      clientAddress,
      'public_mcp',
      config.publicRateLimitPerMinute,
    )
    context.header('x-ratelimit-remaining', String(rate.remaining))
    if (!rate.allowed) {
      return context.json({ error: 'rate_limited' }, 429)
    }

    const actor = await resolvePublicActor(
      database,
      context.req.header('authorization'),
    )
    const taskStore = config.enableNativeMcpTasks
      ? new PostgresTaskStore(database, actor)
      : undefined
    const requestId = context.get('requestId') as string
    const server = createPublicMcpServer({
      config,
      database,
      quarantineDatabase,
      logger,
      metrics,
      actor,
      clientKey: clientAddress,
      requestId,
      ...(taskStore ? { taskStore } : {})
    })
    const transport = new WebStandardStreamableHTTPServerTransport({
      enableJsonResponse: true
    })
    await server.connect(transport)
    return transport.handleRequest(context.req.raw)
  })

  app.get('/public/v1/stats', async (context) => {
    const rate = await consumeRateLimit(
      database,
      getClientAddress(context, config),
      'public_stats',
      Math.max(60, config.publicRateLimitPerMinute),
    )
    context.header('x-ratelimit-remaining', String(rate.remaining))
    if (!rate.allowed) {
      await recordPublicUsage(
        database,
        'public_stats',
        'rate_limited',
        0,
      ).catch(() => undefined)
      return context.json({ error: 'rate_limited' }, 429)
    }
    const stats = await getPublicStats(database)
    context.header(
      'cache-control',
      'public, max-age=300, stale-while-revalidate=3600',
    )
    return context.json(stats)
  })

  app.get('/public/v1/demo/snapshot', async (context) => {
    if (!config.enablePublicDemo) {
      return context.json({ error: 'not_found' }, 404)
    }
    const rate = await consumeRateLimit(
      database,
      getClientAddress(context, config),
      'public_demo_snapshot',
      Math.max(60, config.publicRateLimitPerMinute),
    )
    context.header('x-ratelimit-remaining', String(rate.remaining))
    if (!rate.allowed) {
      return context.json({ error: 'rate_limited' }, 429)
    }
    const snapshot = await getPublicDemoSnapshot(database)
    context.header(
      'cache-control',
      'public, max-age=30, stale-while-revalidate=120',
    )
    return context.json(snapshot)
  })

  app.all('/public/v1/demo/*', (context) =>
    context.json({ error: 'not_found' }, 404),
  )

  app.use('/public/v1/playground/*', async (context, next) => {
    if (!config.enablePlayground) {
      return context.json({ error: 'not_found' }, 404)
    }
    const authorization = context.req.header('authorization')
    const token = authorization?.startsWith('Bearer ')
      ? authorization.slice('Bearer '.length)
      : ''
    if (
      !token ||
      !config.playgroundToken ||
      !constantTimeTokenEquals(token, config.playgroundToken)
    ) {
      return context.json({ error: 'unauthorized' }, 401)
    }
    const clientKey = context.req.header('x-clideck-client-key') ?? ''
    if (!/^[A-Za-z0-9_-]{16,128}$/.test(clientKey)) {
      return context.json({ error: 'invalid_client_key' }, 400)
    }
    context.header('cache-control', 'no-store')
    await next()
  })

  async function consumePlaygroundLimit(
    context: Context<ApiBindings>,
    routeClass: string,
    limit: number,
  ) {
    const clientKey = context.req.header('x-clideck-client-key')!
    const rate = await consumeRateLimit(
      database,
      clientKey,
      routeClass,
      limit,
    )
    context.header('x-ratelimit-remaining', String(rate.remaining))
    return rate.allowed
  }

  app.post('/public/v1/playground/query', async (context) => {
    if (
      !(await consumePlaygroundLimit(
        context,
        'playground_query',
        config.publicRateLimitPerMinute,
      ))
    ) {
      return context.json({ error: 'rate_limited' }, 429)
    }
    const parsed = queryKnowledgeInputSchema.safeParse(
      await context.req.json<unknown>(),
    )
    if (!parsed.success) return context.json({ error: 'invalid_input' }, 400)
    const startedAt = performance.now()
    const resolved = await resolveNetworkContext(database, parsed.data.context)
    const answers = await searchKnowledge(
      database,
      parsed.data.question,
      resolved,
      parsed.data.limit,
    )
    const {
      vendorId: _vendorId,
      platformId: _platformId,
      operatingSystemId: _operatingSystemId,
      ...publicContext
    } = resolved
    await recordPublicUsage(
      database,
      'query_network_knowledge',
      answers.length > 0 ? 'success' : 'unknown',
      performance.now() - startedAt,
    )
    return context.json({
      context: publicContext,
      answers,
      unknown: answers.length === 0,
      next_action:
        answers.length === 0 ? 'request_expert_answer' : 'use_answer'
    })
  })

  app.post('/public/v1/playground/analyze-snapshot', async (context) => {
    if (
      !(await consumePlaygroundLimit(
        context,
        'playground_heavy',
        config.heavyRateLimitPerMinute,
      ))
    ) {
      return context.json({ error: 'rate_limited' }, 429)
    }
    const parsed = snapshotAnalysisInputSchema.safeParse(
      await context.req.json<unknown>(),
    )
    if (!parsed.success) return context.json({ error: 'invalid_input' }, 400)
    return context.json(analyzeDeviceSnapshot(parsed.data))
  })

  app.post('/public/v1/playground/review-change', async (context) => {
    if (
      !(await consumePlaygroundLimit(
        context,
        'playground_heavy',
        config.heavyRateLimitPerMinute,
      ))
    ) {
      return context.json({ error: 'rate_limited' }, 429)
    }
    const parsed = changeReviewInputSchema.safeParse(
      await context.req.json<unknown>(),
    )
    if (!parsed.success) return context.json({ error: 'invalid_input' }, 400)
    const resolved = await resolveNetworkContext(database, parsed.data.context)
    if (
      resolved.vendor_slug !== 'cisco' ||
      resolved.operating_system_slug !== 'ios-xe'
    ) {
      return context.json({
        decision: 'unknown',
        risk_level: 'critical',
        blast_radius: [],
        matched_rules: [],
        unknown_commands: parsed.data.commands ?? [],
        prechecks: [],
        stop_conditions: [
          'Stop: deep change-review coverage is currently limited to Cisco IOS-XE.'
        ],
        verification_plan: [],
        rollback: [],
        approval_required: true,
        verification_token: null,
        verification_token_expires_at: null,
        limitations: [
          'Create an expert task instead of applying unreviewed commands.'
        ]
      })
    }
    return context.json(
      reviewNetworkChange(config, {
        ...parsed.data,
        context: {
          vendor: resolved.vendor,
          model: resolved.model ?? undefined,
          operating_system: resolved.operating_system,
          version: resolved.version ?? undefined
        }
      }),
    )
  })

  app.post('/public/v1/playground/verify-change', async (context) => {
    if (
      !(await consumePlaygroundLimit(
        context,
        'playground_heavy',
        config.heavyRateLimitPerMinute,
      ))
    ) {
      return context.json({ error: 'rate_limited' }, 429)
    }
    const parsed = changeVerificationInputSchema.safeParse(
      await context.req.json<unknown>(),
    )
    if (!parsed.success) return context.json({ error: 'invalid_input' }, 400)
    try {
      return context.json(verifyNetworkChange(config, parsed.data))
    } catch (error) {
      if (
        error instanceof Error &&
        [
          'VERIFICATION_TOKEN_INVALID',
          'VERIFICATION_TOKEN_EXPIRED'
        ].includes(error.message)
      ) {
        return context.json(
          { error: error.message.toLowerCase() },
          400,
        )
      }
      throw error
    }
  })

  app.post('/public/v1/playground/upgrade', async (context) => {
    if (
      !(await consumePlaygroundLimit(
        context,
        'playground_heavy',
        config.heavyRateLimitPerMinute,
      ))
    ) {
      return context.json({ error: 'rate_limited' }, 429)
    }
    const parsed = upgradeAdvisorInputSchema.safeParse(
      await context.req.json<unknown>(),
    )
    if (!parsed.success) return context.json({ error: 'invalid_input' }, 400)
    return context.json(adviseNetworkUpgrade(parsed.data))
  })

  app.post('/public/v1/playground/topology', async (context) => {
    if (
      !(await consumePlaygroundLimit(
        context,
        'playground_heavy',
        config.heavyRateLimitPerMinute,
      ))
    ) {
      return context.json({ error: 'rate_limited' }, 429)
    }
    const parsed = networkPathInputSchema.safeParse(
      await context.req.json<unknown>(),
    )
    if (!parsed.success) return context.json({ error: 'invalid_input' }, 400)
    return context.json(analyzeNetworkPath(parsed.data))
  })

  app.post('/public/v1/playground/expert/request', async (context) => {
    const clientKey = context.req.header('x-clideck-client-key')!
    const rate = await consumeDailyRateLimit(
      database,
      clientKey,
      'playground_expert',
      config.expertRateLimitPerDay,
    )
    context.header('x-ratelimit-remaining', String(rate.remaining))
    if (!rate.allowed) {
      return context.json({ error: 'rate_limited' }, 429)
    }
    const parsed = requestExpertAnswerInputSchema.safeParse(
      await context.req.json<unknown>(),
    )
    if (!parsed.success) return context.json({ error: 'invalid_input' }, 400)
    return context.json(
      await createExpertTask(
        database,
        config,
        { kind: 'anonymous' },
        parsed.data.question,
        parsed.data.context,
      ),
    )
  })

  app.post('/public/v1/playground/expert/status', async (context) => {
    if (
      !(await consumePlaygroundLimit(
        context,
        'playground_query',
        config.publicRateLimitPerMinute,
      ))
    ) {
      return context.json({ error: 'rate_limited' }, 429)
    }
    const parsed = taskCredentialsSchema.safeParse(
      await context.req.json<unknown>(),
    )
    if (!parsed.success) return context.json({ error: 'invalid_input' }, 400)
    return context.json(
      await getExpertTask(
        database,
        { kind: 'anonymous' },
        parsed.data.task_id,
        parsed.data.access_token,
      ),
    )
  })

  app.post('/public/v1/playground/feedback', async (context) => {
    if (
      !(await consumePlaygroundLimit(
        context,
        'playground_feedback',
        config.publicRateLimitPerMinute,
      ))
    ) {
      return context.json({ error: 'rate_limited' }, 429)
    }
    const parsed = feedbackInputSchema.safeParse(
      await context.req.json<unknown>(),
    )
    if (!parsed.success) return context.json({ error: 'invalid_input' }, 400)
    if (parsed.data.sample_contribution) {
      const clientKey = context.req.header('x-clideck-client-key')!
      const rate = await consumeDailyRateLimit(
        database,
        clientKey,
        'playground_contribution',
        config.contributionRateLimitPerDay,
      )
      if (!rate.allowed) {
        return context.json({ error: 'rate_limited' }, 429)
      }
    }
    return context.json(
      await submitFeedback(
        database,
        quarantineDatabase,
        { kind: 'anonymous' },
        parsed.data,
      ),
    )
  })

  if (dependencies.exposeAdminRoutes ?? config.enableRemoteAdminApi) {
  app.use('/admin/*', requireStaticBearer(config.adminToken))
  app.use(
    '/admin/*',
    requireSignedAdminActor(config.adminActorHmacSecret),
  )
  app.use('/admin/*', async (context, next) => {
    context.header('cache-control', 'no-store')
    const actor = context.get('adminActor')
    const rate = await consumeRateLimit(
      database,
      `admin:${actor.id}`,
      'admin_api',
      config.adminRateLimitPerMinute,
    )
    context.header('x-ratelimit-remaining', String(rate.remaining))
    if (!rate.allowed) {
      return context.json({ error: 'rate_limited' }, 429)
    }
    await next()
  })

  app.get('/admin/v1/overview', async (context) => {
    return context.json(
      await getAdminOverview(adminDatabase, config.deployCommitSha),
    )
  })

  app.get('/admin/v1/coverage', async (context) =>
    context.json(await listCoverageTargets(adminDatabase)),
  )

  app.get('/admin/v1/sources', async (context) => {
    const status = context.req.query('status')?.trim() || null
    const limit = Math.min(
      500,
      Math.max(1, Number(context.req.query('limit') ?? 200) || 200),
    )
    return context.json(await listSources(adminDatabase, status, limit))
  })

  app.get('/admin/v1/pipeline', async (context) =>
    context.json(await getPipelineDetails(adminDatabase)),
  )

  app.get('/admin/v1/active-source', async (context) =>
    context.json(await getActiveSource(adminDatabase)),
  )

  app.get('/admin/v1/knowledge', async (context) => {
    const limit = Math.min(
      100,
      Math.max(1, Number(context.req.query('limit') ?? 50) || 50),
    )
    const offset = Math.min(
      100_000,
      Math.max(0, Number(context.req.query('offset') ?? 0) || 0),
    )
    const query = (name: string) => context.req.query(name)?.trim() || null
    return context.json(await listKnowledge(adminDatabase, {
      query: query('q'),
      vendor: query('vendor'),
      operatingSystem: query('operating_system'),
      kind: query('kind'),
      risk: query('risk'),
      origin: query('origin'),
      limit,
      offset
    }))
  })

  app.get('/admin/v1/imports', async (context) =>
    context.json(await listImports(adminDatabase)),
  )

  app.get('/admin/v1/agent-runs', async (context) => {
    const limit = Math.min(
      500,
      Math.max(1, Number(context.req.query('limit') ?? 200) || 200),
    )
    return context.json(await listAgentRuns(adminDatabase, limit))
  })

  app.get('/admin/v1/quality', async (context) =>
    context.json(await getQualityDashboard(adminDatabase)),
  )

  app.get('/admin/v1/lab', async (context) =>
    context.json(await listLabValidations(adminDatabase)),
  )

  app.get('/admin/v1/feedback', async (context) =>
    context.json(await listFeedback(adminDatabase)),
  )

  const superAdminMutation = z.object({
    reason: z.string().trim().min(5).max(2_000).optional()
  })

  app.post('/admin/v1/pipeline/state', async (context) => {
    const actor = context.get('adminActor')
    if (actor.role !== 'super_admin') {
      return context.json({ error: 'forbidden' }, 403)
    }
    const parsed = superAdminMutation.extend({
      enabled: z.boolean()
    }).safeParse(await context.req.json<unknown>())
    if (!parsed.success) {
      return context.json({ error: 'invalid_pipeline_state' }, 400)
    }
    return context.json(await setPipelineEnabled(
      adminDatabase,
      parsed.data.enabled,
      actor,
      parsed.data.reason ?? null,
    ))
  })

  app.post('/admin/v1/pipeline/concurrency', async (context) => {
    const actor = context.get('adminActor')
    if (actor.role !== 'super_admin') {
      return context.json({ error: 'forbidden' }, 403)
    }
    const parsed = z.object({
      max_concurrent_ai_runs: z.number().int().min(1).max(4)
    }).safeParse(await context.req.json<unknown>())
    if (!parsed.success) {
      return context.json({ error: 'invalid_pipeline_concurrency' }, 400)
    }
    return context.json(await setPipelineConcurrency(
      adminDatabase,
      parsed.data.max_concurrent_ai_runs,
      actor,
    ))
  })

  app.post('/admin/v1/coverage/:targetId/priority', async (context) => {
    const actor = context.get('adminActor')
    if (actor.role !== 'super_admin') {
      return context.json({ error: 'forbidden' }, 403)
    }
    const targetId = context.req.param('targetId')
    const parsed = z.object({
      priority: z.number().int().min(-100).max(100)
    }).safeParse(await context.req.json<unknown>())
    if (!z.uuid().safeParse(targetId).success || !parsed.success) {
      return context.json({ error: 'invalid_priority' }, 400)
    }
    const result = await updateCoveragePriority(
      adminDatabase,
      targetId,
      parsed.data.priority,
      actor,
    )
    return result
      ? context.json(result)
      : context.json({ error: 'not_found' }, 404)
  })

  app.post('/admin/v1/sources/:sourceId/action', async (context) => {
    const actor = context.get('adminActor')
    if (actor.role !== 'super_admin') {
      return context.json({ error: 'forbidden' }, 403)
    }
    const sourceId = context.req.param('sourceId')
    const parsed = z.object({
      action: z.enum(['retry', 'skip', 'reject']),
      reason: z.string().trim().min(5).max(2_000).optional()
    }).safeParse(await context.req.json<unknown>())
    if (!z.uuid().safeParse(sourceId).success || !parsed.success) {
      return context.json({ error: 'invalid_source_action' }, 400)
    }
    const result = await actOnSource(
      adminDatabase,
      sourceId,
      parsed.data.action,
      actor,
      parsed.data.reason ?? null,
    )
    return result
      ? context.json(result)
      : context.json({ error: 'not_found' }, 404)
  })

  app.post('/admin/v1/pipeline/discover', async (context) => {
    const actor = context.get('adminActor')
    if (actor.role !== 'super_admin') {
      return context.json({ error: 'forbidden' }, 403)
    }
    const parsed = z.object({
      coverage_target_id: z.uuid().nullable().default(null)
    }).safeParse(await context.req.json<unknown>())
    if (!parsed.success) {
      return context.json({ error: 'invalid_discovery_request' }, 400)
    }
    const result = await forceDiscovery(
      adminDatabase,
      actor,
      parsed.data.coverage_target_id,
    )
    return result
      ? context.json(result)
      : context.json({ error: 'not_found' }, 404)
  })

  app.post('/admin/v1/tasks/:taskId/action', async (context) => {
    const actor = context.get('adminActor')
    if (actor.role !== 'super_admin') {
      return context.json({ error: 'forbidden' }, 403)
    }
    const taskId = context.req.param('taskId')
    const parsed = z.object({
      action: z.enum(['requeue', 'cancel']),
      reason: z.string().trim().min(5).max(2_000).optional()
    }).safeParse(await context.req.json<unknown>())
    if (
      !/^ekt_[A-Za-z0-9_-]{32}$/.test(taskId) ||
      !parsed.success
    ) {
      return context.json({ error: 'invalid_task_action' }, 400)
    }
    const result = await actOnExpertTask(
      adminDatabase,
      taskId,
      parsed.data.action,
      actor,
      parsed.data.reason ?? null,
    )
    return result
      ? context.json(result)
      : context.json({ error: 'not_found' }, 404)
  })

  app.post('/admin/v1/conflicts/:conflictId/decision', async (context) => {
    const actor = context.get('adminActor')
    if (actor.role !== 'super_admin') {
      return context.json({ error: 'forbidden' }, 403)
    }
    const conflictId = context.req.param('conflictId')
    const parsed = z.object({
      decision: z.enum(['resolved', 'accepted']),
      reason: z.string().trim().min(5).max(2_000)
    }).safeParse(await context.req.json<unknown>())
    if (!z.uuid().safeParse(conflictId).success || !parsed.success) {
      return context.json({ error: 'invalid_conflict_decision' }, 400)
    }
    const result = await decideConflict(
      adminDatabase,
      conflictId,
      parsed.data.decision,
      parsed.data.reason,
      actor,
    )
    return result
      ? context.json(result)
      : context.json({ error: 'not_found_or_already_decided' }, 404)
  })

  app.get('/admin/v1/tasks', async (context) => {
    const result = await adminDatabase.query(
      `SELECT
         et.public_id,
         et.tenant_id,
         et.status,
         et.priority,
         et.attempts,
         et.claim_owner,
         et.lease_until,
         et.expires_at,
         et.created_at,
         et.updated_at,
         et.completed_at,
         et.failure_code,
         et.failure_message,
         et.result_revision_id,
         latest_event.stage,
         latest_event.progress_percent,
         latest_event.public_message,
         release.sequence AS result_release_sequence
       FROM expert_tasks et
       LEFT JOIN LATERAL (
         SELECT stage, progress_percent, public_message
         FROM task_public_events
         WHERE task_id = et.id
         ORDER BY created_at DESC, id DESC
         LIMIT 1
       ) latest_event ON true
       LEFT JOIN LATERAL (
         SELECT r.sequence
         FROM release_items ri
         JOIN releases r ON r.id = ri.release_id
         WHERE ri.revision_id = et.result_revision_id
         ORDER BY r.sequence DESC
         LIMIT 1
       ) release ON true
       ORDER BY et.created_at DESC
       LIMIT 100`,
    )
    return context.json(result.rows)
  })

  app.get('/admin/v1/conflicts', async (context) => {
    const result = await adminDatabase.query(
      `SELECT id, left_revision_id, right_revision_id, severity,
              description, status, created_at, resolved_at
       FROM knowledge_conflicts
       ORDER BY created_at DESC
       LIMIT 100`,
    )
    return context.json(result.rows)
  })

  app.get('/admin/v1/releases', async (context) => {
    const result = await adminDatabase.query(
      `SELECT
         r.id, r.sequence, r.status, r.reason, r.created_by, r.created_at,
         (ar.release_id IS NOT NULL) AS active,
         count(ri.revision_id)::int AS revision_count
       FROM releases r
       LEFT JOIN active_release ar ON ar.release_id = r.id
       LEFT JOIN release_items ri ON ri.release_id = r.id
       GROUP BY r.id, ar.release_id
       ORDER BY r.sequence DESC
       LIMIT 100`,
    )
    return context.json(result.rows)
  })

  app.post('/admin/v1/releases/:releaseId/activate', async (context) => {
    const actor = context.get('adminActor')
    if (actor.role !== 'super_admin') {
      return context.json({ error: 'forbidden' }, 403)
    }
    const releaseId = context.req.param('releaseId')
    if (!/^[0-9a-f-]{36}$/.test(releaseId)) {
      return context.json({ error: 'invalid_release_id' }, 400)
    }
    const parsed = z.object({
      reason: z.string().trim().min(5).max(2_000).optional()
    }).safeParse(await context.req.json<unknown>())
    if (!parsed.success) {
      return context.json({ error: 'invalid_release_activation' }, 400)
    }
    const result = await adminDatabase.query(
      `WITH switched AS (
         INSERT INTO active_release (singleton, release_id, switched_by)
         SELECT true, id, $2
         FROM releases
         WHERE id = $1
         ON CONFLICT (singleton)
         DO UPDATE SET
           release_id = excluded.release_id,
           switched_at = now(),
           switched_by = excluded.switched_by
         RETURNING release_id
       )
       SELECT
         r.id, r.sequence, r.status, r.reason, r.created_by, r.created_at,
         true AS active,
         count(ri.revision_id)::int AS revision_count
       FROM switched s
       JOIN releases r ON r.id = s.release_id
       LEFT JOIN release_items ri ON ri.release_id = r.id
       GROUP BY r.id`,
      [releaseId, actor.id],
    )
    if (!result.rows[0]) return context.json({ error: 'not_found' }, 404)
    await recordAdminAudit(
      adminDatabase,
      actor,
      'release.activate',
      'release',
      releaseId,
      {
        sequence: result.rows[0].sequence,
        reason: parsed.data.reason ?? null
      },
    )
    return context.json(result.rows[0])
  })

  app.get('/admin/v1/revisions/:revisionId/provenance', async (context) => {
    const actor = context.get('adminActor')
    if (actor.role !== 'super_admin') {
      return context.json({ error: 'forbidden' }, 403)
    }
    const revisionId = context.req.param('revisionId')
    if (!/^[0-9a-f-]{36}$/.test(revisionId)) {
      return context.json({ error: 'invalid_revision_id' }, 400)
    }
    const result = await adminDatabase.query(
      `SELECT
         kr.id::text AS revision_id,
         CASE
           WHEN lrm.revision_id IS NOT NULL THEN
             jsonb_build_object(
               'origin', 'legacy_import',
               'legacy_key', lrm.legacy_key,
               'item_type', lrm.legacy_item_type,
               'source_trust', lrm.source_trust,
               'lifecycle_status', lrm.lifecycle_status,
               'original_risk_level', lrm.original_risk_level,
               'original_confidence', lrm.original_confidence,
               'original_quality_score', lrm.original_quality_score,
               'published_at', lrm.published_at,
               'provenance', lrm.provenance,
               'payload_hash', lrm.payload_hash
             )
           ELSE coalesce((
             SELECT jsonb_agg(
               jsonb_build_object(
                 'vendor', v.display_name,
                 'title', sd.title,
                 'document_version', sd.document_version,
                 'canonical_url', sd.canonical_url,
                 'document_date', sd.document_date,
                 'verified_at', sd.verified_at,
                 'content_hash', sd.content_hash,
                 'evidence_fragment', sd.evidence_fragment,
                 'evidence_role', rs.evidence_role,
                 'confidence_reason', rs.confidence_reason
               )
               ORDER BY rs.evidence_role, sd.verified_at DESC
             )
             FROM revision_sources rs
             JOIN source_documents sd ON sd.id = rs.source_document_id
             JOIN vendors v ON v.id = sd.vendor_id
             WHERE rs.revision_id = kr.id
           ), '[]'::jsonb)
         END AS provenance,
         kr.created_at,
         kr.status
       FROM knowledge_revisions kr
       LEFT JOIN legacy_revision_metadata lrm ON lrm.revision_id = kr.id
       WHERE kr.id = $1`,
      [revisionId],
    )
    if (!result.rows[0]) return context.json({ error: 'not_found' }, 404)
    return context.json(result.rows[0])
  })

  app.get('/admin/v1/code-change-approvals', async (context) => {
    const result = await adminDatabase.query(
      `SELECT
         cca.id,
         coalesce(et.public_id, cca.task_id::text, 'unlinked') AS task_id,
         cca.repository,
         cca.summary,
         cca.risk_assessment,
         cca.status,
         cca.requested_by,
         cca.decided_by,
         cca.decision_reason,
         cca.created_at,
         cca.decided_at
       FROM code_change_approvals cca
       LEFT JOIN expert_tasks et ON et.id = cca.task_id
       ORDER BY cca.created_at DESC
       LIMIT 100`,
    )
    return context.json(result.rows)
  })

  app.post('/admin/v1/code-change-approvals/:approvalId/decision', async (context) => {
    const actor = context.get('adminActor')
    if (actor.role !== 'super_admin') {
      return context.json({ error: 'forbidden' }, 403)
    }
    const approvalId = context.req.param('approvalId')
    if (!/^[0-9a-f-]{36}$/.test(approvalId)) {
      return context.json({ error: 'invalid_approval_id' }, 400)
    }
    const body = await context.req.json<unknown>()
    if (
      typeof body !== 'object' ||
      body === null ||
      !('decision' in body) ||
      !['approved', 'rejected'].includes(String(body.decision)) ||
      !('reason' in body) ||
      typeof body.reason !== 'string' ||
      body.reason.length < 5 ||
      body.reason.length > 2_000
    ) {
      return context.json({ error: 'invalid_decision' }, 400)
    }
    const result = await adminDatabase.query(
      `WITH updated AS (
         UPDATE code_change_approvals
            SET status = $2,
                decision_reason = $3,
                decided_by = $4,
                decided_at = now()
          WHERE id = $1
            AND status = 'approval_required'
          RETURNING *
       )
       SELECT
         updated.id,
         coalesce(et.public_id, updated.task_id::text, 'unlinked') AS task_id,
         updated.repository,
         updated.summary,
         updated.risk_assessment,
         updated.status,
         updated.requested_by,
         updated.decided_by,
         updated.decision_reason,
         updated.created_at,
         updated.decided_at
       FROM updated
       LEFT JOIN expert_tasks et ON et.id = updated.task_id`,
      [approvalId, String(body.decision), body.reason, actor.id],
    )
    if (!result.rows[0]) {
      return context.json({ error: 'not_found_or_already_decided' }, 404)
    }
    await recordAdminAudit(
      adminDatabase,
      actor,
      'code_approval.decision',
      'code_change_approval',
      approvalId,
      { decision: String(body.decision) },
    )
    return context.json(result.rows[0])
  })
  }

  if (config.enablePublicDemo) {
    const demoAssetRoot = resolve(config.demoAssetRoot)
    const demoIndexPath = resolve(demoAssetRoot, 'index.html')
    if (existsSync(demoAssetRoot)) {
      app.use(
        '/demo/assets/*',
        serveStatic({
          root: demoAssetRoot,
          rewriteRequestPath: (path) => path.replace(/^\/demo/, ''),
          onFound: (_path, context) => {
            context.header(
              'cache-control',
              'public, max-age=31536000, immutable',
            )
          }
        }),
      )
    }
    const serveDemoIndex = async (context: Context<ApiBindings>) => {
      try {
        const html = await readFile(demoIndexPath, 'utf8')
        context.header('cache-control', 'no-cache')
        return context.html(html)
      } catch {
        return context.json({ error: 'demo_not_built' }, 503)
      }
    }
    app.get('/demo', serveDemoIndex)
    app.get('/demo/*', serveDemoIndex)
  }

  app.notFound((context) => context.json({ error: 'not_found' }, 404))
  app.onError((error, context) => {
    const requestId = context.get('requestId') as string | undefined
    logger.error({ err: error, requestId }, 'Unhandled API error')
    return context.json(
      { error: 'internal_error', request_id: requestId ?? null },
      500,
    )
  })

  return app
}
