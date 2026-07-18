import { randomUUID } from 'node:crypto'

import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { Hono, type Context } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { secureHeaders } from 'hono/secure-headers'
import { timeout } from 'hono/timeout'

import type { AppConfig } from '../config.js'
import { constantTimeTokenEquals } from '../crypto.js'
import type { Database } from '../db.js'
import { resolvePublicActor } from '../domain/auth.js'
import {
  reviewNetworkChange,
  verifyNetworkChange
} from '../domain/change.js'
import { resolveNetworkContext } from '../domain/context.js'
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
  consumeDailyRateLimit,
  consumeRateLimit,
  getClientAddress,
  requestPolicy,
  requireStaticBearer
} from './security.js'

type ApiDependencies = {
  config: AppConfig
  database: Database
  adminDatabase: Database
  quarantineDatabase: Database
  logger: Logger
  metrics: Metrics
}

type ApiBindings = {
  Variables: {
    requestId: string
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
      version: '0.2.0'
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

  app.use('/admin/*', requireStaticBearer(config.adminToken))
  app.use('/admin/*', async (context, next) => {
    const rate = await consumeRateLimit(
      database,
      getClientAddress(context, config),
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
    const result = await adminDatabase.query<{
      active_release: string | null
      published_revisions: number
      queued_tasks: number
      open_conflicts: number
      feedback_24h: number
    }>(
      `SELECT
         (SELECT release_id::text FROM active_release) AS active_release,
         (SELECT count(*)::int FROM public_active_knowledge) AS published_revisions,
         (SELECT count(*)::int FROM expert_tasks WHERE status = 'queued') AS queued_tasks,
         (SELECT count(*)::int FROM knowledge_conflicts WHERE status = 'open') AS open_conflicts,
         (SELECT count(*)::int FROM feedback WHERE created_at >= now() - interval '24 hours') AS feedback_24h`,
    )
    return context.json(result.rows[0])
  })

  app.get('/admin/v1/tasks', async (context) => {
    const result = await adminDatabase.query(
      `SELECT
         public_id, tenant_id, status, priority, attempts,
         claim_owner, lease_until, expires_at, created_at, updated_at
       FROM expert_tasks
       ORDER BY created_at DESC
       LIMIT 100`,
    )
    return context.json({ tasks: result.rows })
  })

  app.get('/admin/v1/conflicts', async (context) => {
    const result = await adminDatabase.query(
      `SELECT id, left_revision_id, right_revision_id, severity,
              description, status, created_at, resolved_at
       FROM knowledge_conflicts
       ORDER BY created_at DESC
       LIMIT 100`,
    )
    return context.json({ conflicts: result.rows })
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
    return context.json({ releases: result.rows })
  })

  app.post('/admin/v1/releases/:releaseId/activate', async (context) => {
    const releaseId = context.req.param('releaseId')
    if (!/^[0-9a-f-]{36}$/.test(releaseId)) {
      return context.json({ error: 'invalid_release_id' }, 400)
    }
    const result = await adminDatabase.query(
      `INSERT INTO active_release (singleton, release_id, switched_by)
       SELECT true, id, 'super_admin'
       FROM releases
       WHERE id = $1
       ON CONFLICT (singleton)
       DO UPDATE SET
         release_id = excluded.release_id,
         switched_at = now(),
         switched_by = excluded.switched_by
       RETURNING release_id, switched_at`,
      [releaseId],
    )
    if (!result.rows[0]) return context.json({ error: 'not_found' }, 404)
    return context.json(result.rows[0])
  })

  app.get('/admin/v1/revisions/:revisionId/provenance', async (context) => {
    const revisionId = context.req.param('revisionId')
    if (!/^[0-9a-f-]{36}$/.test(revisionId)) {
      return context.json({ error: 'invalid_revision_id' }, 400)
    }
    const result = await adminDatabase.query(
      `SELECT
         sd.id,
         sd.canonical_url,
         sd.document_type,
         sd.title,
         v.display_name AS vendor,
         sd.document_version,
         sd.document_date,
         sd.verified_at,
         sd.content_hash,
         sd.evidence_fragment,
         rs.evidence_role,
         rs.confidence_reason
       FROM revision_sources rs
       JOIN source_documents sd ON sd.id = rs.source_document_id
       JOIN vendors v ON v.id = sd.vendor_id
       WHERE rs.revision_id = $1
       ORDER BY rs.evidence_role, sd.verified_at DESC`,
      [revisionId],
    )
    return context.json({ provenance: result.rows })
  })

  app.get('/admin/v1/code-change-approvals', async (context) => {
    const result = await adminDatabase.query(
      `SELECT
         cca.id,
         et.public_id AS task_id,
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
    return context.json({ approvals: result.rows })
  })

  app.post('/admin/v1/code-change-approvals/:approvalId/decision', async (context) => {
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
      `UPDATE code_change_approvals
          SET status = $2,
              decision_reason = $3,
              decided_by = 'super_admin',
              decided_at = now()
        WHERE id = $1
          AND status = 'approval_required'
        RETURNING id, status, decided_at`,
      [approvalId, String(body.decision), body.reason],
    )
    if (!result.rows[0]) {
      return context.json({ error: 'not_found_or_already_decided' }, 404)
    }
    return context.json(result.rows[0])
  })

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
