import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { serveStatic } from '@hono/node-server/serve-static'
import {
  activeSourceDetailSchema,
  activeSourceLanesSchema,
  agentRunsSchema,
  approvalsSchema,
  conflictsSchema,
  coverageTargetsSchema,
  expertTasksSchema,
  feedbackRowsSchema,
  importRunsSchema,
  knowledgePageSchema,
  labSchema,
  mcpRequestLogDetailSchema,
  mcpRequestLogPageSchema,
  overviewSchema,
  pipelineDetailsSchema,
  pipelineTransitionsSchema,
  provenanceSchema,
  qualitySchema,
  releasesSchema,
  reviewExceptionDetailSchema,
  reviewExceptionsSchema,
  sourcesSchema
} from '@clideck/admin-contracts'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { Hono, type Context } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { routePath } from 'hono/route'
import { secureHeaders } from 'hono/secure-headers'
import { timeout } from 'hono/timeout'
import { z } from 'zod'

import type { AppConfig } from '../config.js'
import { constantTimeTokenEquals } from '../crypto.js'
import type { Database } from '../db.js'
import { resolvePublicActor } from '../domain/auth.js'
import {
  actOnExpertTask,
  actOnReviewException,
  actOnSource,
  decideConflict,
  forceDiscovery,
  getActiveSource,
  getActiveSources,
  getAdminOverview,
  getMcpRequestLog,
  getPipelineDetails,
  getQualityDashboard,
  getRevisionProvenance,
  getReviewException,
  listAgentRuns,
  listCodeChangeApprovals,
  listConflicts,
  listCoverageTargets,
  listExpertTasks,
  listFeedback,
  listImports,
  listKnowledge,
  listLabValidations,
  listMcpRequestLogs,
  listReleases,
  listReviewExceptions,
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
import { searchKnowledge } from '../domain/knowledge.js'
import { listPipelineTransitions } from '../domain/pipeline-transitions.js'
import {
  sanitizeDemoActiveSource,
  sanitizeDemoActiveSources,
  sanitizeDemoExpertTasks,
  sanitizeDemoFeedback,
  sanitizeDemoImports,
  sanitizeDemoMcpRequestDetail,
  sanitizeDemoMcpRequestPage,
  sanitizeDemoOverview,
  sanitizeDemoPipeline,
  sanitizeDemoProvenance,
  sanitizeDemoReleases,
  sanitizeDemoReviewException,
  sanitizeDemoReviewExceptions,
  sanitizeDemoSources
} from '../domain/public-demo.js'
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
import { activateKnowledgeRelease } from '../domain/publication.js'
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

function parseHttpContract<T>(
  schema: z.ZodType<T>,
  value: unknown,
): T {
  return schema.parse(JSON.parse(JSON.stringify(value)))
}

function parseTransitionCursor(value: string | undefined): string | null | undefined {
  if (value === undefined || value === '') return null
  if (!/^\d{1,19}$/.test(value)) return undefined
  try {
    return BigInt(value) <= 9_223_372_036_854_775_807n
      ? value
      : undefined
  } catch {
    return undefined
  }
}

function parseMcpRequestLogQuery(context: Context<ApiBindings>) {
  const limit = Math.min(
    100,
    Math.max(1, Number(context.req.query('limit') ?? 25) || 25),
  )
  const offset = Math.min(
    1_000_000,
    Math.max(0, Number(context.req.query('offset') ?? 0) || 0),
  )
  const tool = context.req.query('tool')?.trim() || null
  const requestedOutcome = context.req.query('outcome')?.trim() || null
  const outcome = requestedOutcome && [
    'success',
    'unknown',
    'blocked',
    'error',
    'rate_limited'
  ].includes(requestedOutcome)
    ? requestedOutcome
    : null
  const query = context.req.query('q')?.trim().slice(0, 200) || null
  return { limit, offset, tool, outcome, query }
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
    const suppliedRequestId = context.req.header('x-request-id')
    const requestId = z.uuid().safeParse(suppliedRequestId).success
      ? suppliedRequestId!
      : randomUUID()
    context.set('requestId', requestId)
    context.header('x-request-id', requestId)
    const startedAt = performance.now()
    await next()
    if (context.req.path.startsWith('/_clideck-mcp-ui/assets/')) {
      context.header(
        'cache-control',
        'public, max-age=31536000, immutable',
      )
    }
    const matchedRoute = routePath(context, -1)
    metrics.httpRequests.inc({
      process: 'api',
      route:
        context.res.status === 404 || matchedRoute === '*'
          ? '__unmatched__'
          : matchedRoute,
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
      version: '0.8.3'
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
      clientAddress,
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

  app.use('/public/v1/demo/*', async (context, next) => {
    if (!config.enablePublicDemo) {
      return context.json({ error: 'not_found' }, 404)
    }
    if (!['GET', 'HEAD'].includes(context.req.method)) {
      return context.json({ error: 'method_not_allowed' }, 405)
    }
    const rate = await consumeRateLimit(
      database,
      getClientAddress(context, config),
      'public_demo_read',
      Math.max(60, config.publicRateLimitPerMinute),
    )
    context.header('x-ratelimit-remaining', String(rate.remaining))
    if (!rate.allowed) {
      return context.json({ error: 'rate_limited' }, 429)
    }
    context.header('cache-control', 'no-store')
    await next()
  })

  app.get('/public/v1/demo/overview', async (context) =>
    context.json(sanitizeDemoOverview(parseHttpContract(
      overviewSchema,
      await getAdminOverview(adminDatabase, config.deployCommitSha),
    ))),
  )

  app.get('/public/v1/demo/mcp-requests', async (context) => {
    const page = parseHttpContract(
      mcpRequestLogPageSchema,
      await listMcpRequestLogs(
        adminDatabase,
        {
          ...parseMcpRequestLogQuery(context),
          queryScope: 'response_only'
        },
      ),
    )
    return context.json(sanitizeDemoMcpRequestPage(page))
  })

  app.get('/public/v1/demo/mcp-requests/:requestLogId', async (context) => {
    const id = context.req.param('requestLogId')
    if (!/^\d{1,19}$/.test(id)) {
      return context.json({ error: 'invalid_request_log_id' }, 400)
    }
    const detail = await getMcpRequestLog(adminDatabase, id)
    if (!detail) return context.json({ error: 'not_found' }, 404)
    return context.json(sanitizeDemoMcpRequestDetail(parseHttpContract(
      mcpRequestLogDetailSchema,
      detail,
    )))
  })

  app.get('/public/v1/demo/pipeline/transitions', async (context) => {
    const after = parseTransitionCursor(context.req.query('after'))
    if (after === undefined) {
      return context.json({ error: 'invalid_cursor' }, 400)
    }
    return context.json(parseHttpContract(
      pipelineTransitionsSchema,
      await listPipelineTransitions(adminDatabase, after),
    ))
  })

  app.get('/public/v1/demo/coverage', async (context) =>
    context.json(parseHttpContract(
      coverageTargetsSchema,
      await listCoverageTargets(adminDatabase),
    )),
  )

  app.get('/public/v1/demo/sources', async (context) => {
    const status = context.req.query('status')?.trim() || null
    const limit = Math.min(
      500,
      Math.max(1, Number(context.req.query('limit') ?? 200) || 200),
    )
    return context.json(sanitizeDemoSources(parseHttpContract(
      sourcesSchema,
      await listSources(adminDatabase, status, limit),
    )))
  })

  app.get('/public/v1/demo/pipeline', async (context) =>
    context.json(sanitizeDemoPipeline(parseHttpContract(
      pipelineDetailsSchema,
      await getPipelineDetails(adminDatabase),
    ))),
  )

  app.get('/public/v1/demo/active-source', async (context) =>
    context.json(sanitizeDemoActiveSource(parseHttpContract(
      activeSourceDetailSchema,
      await getActiveSource(adminDatabase),
    ))),
  )

  app.get('/public/v1/demo/active-sources', async (context) =>
    context.json(sanitizeDemoActiveSources(parseHttpContract(
      activeSourceLanesSchema,
      await getActiveSources(adminDatabase),
    ))),
  )

  app.get('/public/v1/demo/review-exceptions', async (context) => {
    const requested = context.req.query('status')
    const status =
      requested === 'manual_exception' || requested === 'quarantined'
        ? requested
        : null
    return context.json(sanitizeDemoReviewExceptions(parseHttpContract(
      reviewExceptionsSchema,
      await listReviewExceptions(adminDatabase, status),
    )))
  })

  app.get(
    '/public/v1/demo/review-exceptions/:candidateId',
    async (context) => {
      const candidateId = context.req.param('candidateId')
      if (!z.uuid().safeParse(candidateId).success) {
        return context.json({ error: 'invalid_candidate_id' }, 400)
      }
      const exception = await getReviewException(
        adminDatabase,
        candidateId,
      )
      return exception
        ? context.json(sanitizeDemoReviewException(parseHttpContract(
            reviewExceptionDetailSchema,
            exception,
          )))
        : context.json({ error: 'not_found' }, 404)
    },
  )

  app.get('/public/v1/demo/knowledge', async (context) => {
    const limit = Math.min(
      100,
      Math.max(1, Number(context.req.query('limit') ?? 50) || 50),
    )
    const offset = Math.min(
      100_000,
      Math.max(0, Number(context.req.query('offset') ?? 0) || 0),
    )
    const query = (name: string) => context.req.query(name)?.trim() || null
    return context.json(parseHttpContract(
      knowledgePageSchema,
      await listKnowledge(adminDatabase, {
        query: query('q'),
        vendor: query('vendor'),
        operatingSystem: query('operating_system'),
        kind: query('kind'),
        risk: query('risk'),
        origin: query('origin'),
        limit,
        offset
      }),
    ))
  })

  app.get('/public/v1/demo/imports', async (context) =>
    context.json(sanitizeDemoImports(parseHttpContract(
      importRunsSchema,
      await listImports(adminDatabase),
    ))),
  )

  app.get('/public/v1/demo/agent-runs', async (context) => {
    const limit = Math.min(
      500,
      Math.max(1, Number(context.req.query('limit') ?? 200) || 200),
    )
    return context.json(parseHttpContract(
      agentRunsSchema,
      await listAgentRuns(adminDatabase, limit),
    ))
  })

  app.get('/public/v1/demo/tasks', async (context) =>
    context.json(sanitizeDemoExpertTasks(parseHttpContract(
      expertTasksSchema,
      await listExpertTasks(adminDatabase),
    ))),
  )

  app.get('/public/v1/demo/quality', async (context) =>
    context.json(parseHttpContract(
      qualitySchema,
      await getQualityDashboard(adminDatabase),
    )),
  )

  app.get('/public/v1/demo/lab', async (context) =>
    context.json(parseHttpContract(
      labSchema,
      await listLabValidations(adminDatabase),
    )),
  )

  app.get('/public/v1/demo/conflicts', async (context) =>
    context.json(parseHttpContract(
      conflictsSchema,
      await listConflicts(adminDatabase),
    )),
  )

  app.get('/public/v1/demo/releases', async (context) =>
    context.json(sanitizeDemoReleases(parseHttpContract(
      releasesSchema,
      await listReleases(adminDatabase),
    ))),
  )

  app.get('/public/v1/demo/feedback', async (context) =>
    context.json(sanitizeDemoFeedback(parseHttpContract(
      feedbackRowsSchema,
      await listFeedback(adminDatabase),
    ))),
  )

  app.get('/public/v1/demo/approvals', async (context) =>
    context.json(parseHttpContract(
      approvalsSchema,
      await listCodeChangeApprovals(adminDatabase),
    )),
  )

  app.get(
    '/public/v1/demo/revisions/:revisionId/provenance',
    async (context) => {
      const revisionId = context.req.param('revisionId')
      if (!z.uuid().safeParse(revisionId).success) {
        return context.json({ error: 'invalid_revision_id' }, 400)
      }
      const provenance = await getRevisionProvenance(
        adminDatabase,
        revisionId,
      )
      if (!provenance) {
        return context.json({ error: 'not_found' }, 404)
      }
      return context.json(sanitizeDemoProvenance(parseHttpContract(
        provenanceSchema,
        provenance,
      )))
    },
  )

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
      Math.min(5, Math.max(1, parsed.data.limit)),
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
    return context.json(
      await reviewNetworkChange(database, config, {
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
      return context.json(
        await verifyNetworkChange(database, config, parsed.data),
      )
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
        parsed.data.idempotency_key,
        clientKey,
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

  app.get('/admin/v1/mcp-requests', async (context) => {
    return context.json(parseHttpContract(
      mcpRequestLogPageSchema,
      await listMcpRequestLogs(
        adminDatabase,
        parseMcpRequestLogQuery(context),
      ),
    ))
  })

  app.get('/admin/v1/mcp-requests/:requestLogId', async (context) => {
    const id = context.req.param('requestLogId')
    if (!/^\d{1,19}$/.test(id)) {
      return context.json({ error: 'invalid_request_log_id' }, 400)
    }
    const detail = await getMcpRequestLog(adminDatabase, id)
    return detail
      ? context.json(parseHttpContract(mcpRequestLogDetailSchema, detail))
      : context.json({ error: 'not_found' }, 404)
  })

  app.get('/admin/v1/pipeline/transitions', async (context) => {
    const after = parseTransitionCursor(context.req.query('after'))
    if (after === undefined) {
      return context.json({ error: 'invalid_cursor' }, 400)
    }
    return context.json(parseHttpContract(
      pipelineTransitionsSchema,
      await listPipelineTransitions(adminDatabase, after),
    ))
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

  app.get('/admin/v1/active-sources', async (context) =>
    context.json(await getActiveSources(adminDatabase)),
  )

  app.get('/admin/v1/review-exceptions', async (context) => {
    const requested = context.req.query('status')
    const status =
      requested === 'manual_exception' || requested === 'quarantined'
        ? requested
        : null
    return context.json(
      await listReviewExceptions(adminDatabase, status),
    )
  })

  app.get(
    '/admin/v1/review-exceptions/:candidateId',
    async (context) => {
      const candidateId = context.req.param('candidateId')
      if (!z.uuid().safeParse(candidateId).success) {
        return context.json({ error: 'invalid_candidate_id' }, 400)
      }
      const exception = await getReviewException(
        adminDatabase,
        candidateId,
      )
      return exception
        ? context.json(exception)
        : context.json({ error: 'not_found' }, 404)
    },
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

  app.post(
    '/admin/v1/review-exceptions/:candidateId/action',
    async (context) => {
      const actor = context.get('adminActor')
      if (actor.role !== 'super_admin') {
        return context.json({ error: 'forbidden' }, 403)
      }
      const candidateId = context.req.param('candidateId')
      const parsed = z.object({
        action: z.enum(['retry_deep', 'publish', 'reject']),
        reason: z.string().trim().min(5).max(2_000)
      }).safeParse(await context.req.json<unknown>())
      if (!z.uuid().safeParse(candidateId).success || !parsed.success) {
        return context.json(
          { error: 'invalid_review_exception_action' },
          400,
        )
      }
      try {
        const result = await actOnReviewException(
          adminDatabase,
          candidateId,
          parsed.data.action,
          actor,
          parsed.data.reason,
        )
        return result
          ? context.json(result)
          : context.json({ error: 'not_found' }, 404)
      } catch (error) {
        if (
          error instanceof Error &&
          error.message.startsWith('MANUAL_PUBLISH_')
        ) {
          return context.json({ error: error.message }, 409)
        }
        throw error
      }
    },
  )

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
    return context.json(await listExpertTasks(adminDatabase))
  })

  app.get('/admin/v1/conflicts', async (context) => {
    return context.json(await listConflicts(adminDatabase))
  })

  app.get('/admin/v1/releases', async (context) => {
    return context.json(await listReleases(adminDatabase))
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
    let activated
    try {
      activated = await activateKnowledgeRelease(
        adminDatabase,
        releaseId,
        actor.id,
      )
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === 'RELEASE_NOT_FOUND'
      ) {
        return context.json({ error: 'not_found' }, 404)
      }
      throw error
    }
    await recordAdminAudit(
      adminDatabase,
      actor,
      'release.activate',
      'release',
      releaseId,
      {
        sequence: activated.sequence,
        reason: parsed.data.reason ?? null
      },
    )
    return context.json(activated)
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
    const provenance = await getRevisionProvenance(adminDatabase, revisionId)
    return provenance
      ? context.json(provenance)
      : context.json({ error: 'not_found' }, 404)
  })

  app.get('/admin/v1/code-change-approvals', async (context) => {
    return context.json(await listCodeChangeApprovals(adminDatabase))
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
    const sharedUiAssetRoot = resolve(config.adminUi.assetRoot)
    const demoIndexPath = resolve(sharedUiAssetRoot, 'index.html')
    if (existsSync(sharedUiAssetRoot)) {
      app.use(
        '/_clideck-mcp-ui/assets/*',
        serveStatic({
          root: sharedUiAssetRoot,
          rewriteRequestPath: (path) =>
            path.replace(/^\/_clideck-mcp-ui/, ''),
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
