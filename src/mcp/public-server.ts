import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js'
import type {
  CreateTaskRequestHandlerExtra,
  TaskRequestHandlerExtra
} from '@modelcontextprotocol/sdk/experimental/tasks/interfaces.js'

import type { AppConfig } from '../config.js'
import {
  type Database,
  isTransientDatabaseError,
  withTransientDatabaseRetry
} from '../db.js'
import type { Logger } from '../logger.js'
import type { Metrics } from '../metrics.js'
import type { PublicActor } from '../domain/auth.js'
import {
  publicNetworkContext,
  resolveNetworkContext,
  unresolvedNetworkContext
} from '../domain/context.js'
import {
  reviewNetworkChange,
  verifyNetworkChange
} from '../domain/change.js'
import {
  describeKnowledgeDomain,
  listKnowledgeDomains,
  searchDomainKnowledge
} from '../domain/domain-knowledge.js'
import {
  describeKnowledgeDomainInputSchema,
  describeKnowledgeDomainOutputSchema,
  listKnowledgeDomainsInputSchema,
  listKnowledgeDomainsOutputSchema,
  queryDomainKnowledgeInputSchema,
  queryDomainKnowledgeOutputSchema
} from '../domain/domain-tool-schemas.js'
import { searchKnowledgeWithCoverage } from '../domain/demand-intelligence.js'
import {
  classifyMcpOutcome,
  getKnowledgeDemandLearningStatus,
  queueApproximateKnowledgeDemand,
  queueUnknownKnowledgeDemand,
  reconcileKnownKnowledgeDemand,
  recordMcpRequest
} from '../domain/mcp-observability.js'
import { analyzeDeviceSnapshot } from '../domain/snapshot.js'
import { recordPublicUsage } from '../domain/telemetry.js'
import { analyzeNetworkPath } from '../domain/topology.js'
import {
  cancelExpertTask,
  continueExpertTask,
  createExpertTask,
  getExpertTask,
  submitFeedback
} from '../domain/tasks.js'
import { adviseNetworkUpgrade } from '../domain/upgrade.js'
import {
  consumeDailyRateLimit,
  consumeRateLimit
} from '../http/security.js'
import {
  changeReviewInputSchema,
  changeReviewOutputSchema,
  changeVerificationInputSchema,
  changeVerificationOutputSchema,
  continueTaskInputSchema,
  createdTaskStatusSchema,
  feedbackInputSchema,
  feedbackOutputSchema,
  getWorkflowInputSchema,
  knowledgeSearchResultSchema,
  networkPathInputSchema,
  networkPathOutputSchema,
  networkContextInputSchema,
  queryKnowledgeInputSchema,
  requestExpertAnswerInputSchema,
  resolvedNetworkContextSchema,
  snapshotAnalysisInputSchema,
  snapshotAnalysisOutputSchema,
  taskCredentialsSchema,
  taskStatusSchema,
  upgradeAdvisorInputSchema,
  upgradeAdvisorOutputSchema
} from '../domain/schemas.js'
import { publicToolError, textAndStructured } from './result.js'
import { PostgresTaskStore } from './postgres-task-store.js'

type PublicServerDependencies = {
  config: AppConfig
  database: Database
  quarantineDatabase: Database
  clientKey: string
  clientAddress: string
  logger: Logger
  metrics: Metrics
  actor: PublicActor
  requestId: string
  taskStore?: PostgresTaskStore
}

function isUnresolvedNetworkContext(error: unknown): boolean {
  return error instanceof Error && [
    'NETWORK_CONTEXT_OS_NOT_RESOLVED',
    'NETWORK_CONTEXT_VENDOR_NOT_RESOLVED'
  ].includes(error.message)
}

async function resolveKnowledgeContext(
  database: Database,
  input: Parameters<typeof unresolvedNetworkContext>[0],
) {
  try {
    const context = await resolveNetworkContext(database, input)
    return { context, publicContext: publicNetworkContext(context) }
  } catch (error) {
    if (!isUnresolvedNetworkContext(error)) throw error
    return { context: null, publicContext: unresolvedNetworkContext(input) }
  }
}

function wrapTool<TInput, TOutput>(
  dependencies: PublicServerDependencies,
  toolName: string,
  operation: (input: TInput) => Promise<TOutput>,
) {
  return async (input: TInput) => {
    const startedAt = performance.now()
    const stopTimer = dependencies.metrics.toolDuration.startTimer({
      tool: toolName
    })
    try {
      if ([
        'analyze_device_snapshot',
        'review_network_change',
        'verify_network_change',
        'advise_network_upgrade',
        'analyze_network_path'
      ].includes(toolName)) {
        const rate = await consumeRateLimit(
          dependencies.database,
          dependencies.clientKey,
          'mcp_heavy',
          dependencies.config.heavyRateLimitPerMinute,
        )
        if (!rate.allowed) throw new Error('RATE_LIMITED')
      }
      const retryableTools = new Set([
        'list_knowledge_domains',
        'describe_knowledge_domain',
        'query_domain_knowledge',
        'resolve_network_context',
        'query_network_knowledge',
        'get_network_workflow',
        'get_expert_task',
        'analyze_device_snapshot',
        'advise_network_upgrade',
        'analyze_network_path'
      ])
      const output = retryableTools.has(toolName)
        ? await withTransientDatabaseRetry(() => operation(input))
        : await operation(input)
      stopTimer({ outcome: 'success' })
      const publicOutput = output as Record<string, unknown>
      const usageOutcome = classifyMcpOutcome(publicOutput)
      const knowledgeDemandId = usageOutcome === 'unknown'
        ? await queueUnknownKnowledgeDemand(
            dependencies.database,
            toolName,
            input,
            publicOutput,
          ).catch((error: unknown) => {
            dependencies.logger.warn(
              {
                err: error,
                requestId: dependencies.requestId,
                tool: toolName
              },
              'Unknown MCP request could not be queued for learning',
            )
            return null
          })
        : usageOutcome === 'success'
          ? await queueApproximateKnowledgeDemand(
              dependencies.database,
              toolName,
              input,
              publicOutput,
            ).then((gapDemandId) => gapDemandId ??
              reconcileKnownKnowledgeDemand(
                dependencies.database,
                toolName,
                input,
                publicOutput,
              )
            ).catch((error: unknown) => {
              dependencies.logger.warn(
                {
                  err: error,
                  requestId: dependencies.requestId,
                  tool: toolName
                },
                'Known MCP request could not reconcile its learning demand',
              )
              return null
            })
          : null
      if (
        publicOutput['answer_status'] === 'partial' ||
        publicOutput['answer_status'] === 'unknown'
      ) {
        publicOutput['learning'] = {
          status: knowledgeDemandId
            ? await getKnowledgeDemandLearningStatus(
                dependencies.database,
                knowledgeDemandId,
              ).catch(() => 'unavailable' as const)
            : 'unavailable'
        }
      } else if (publicOutput['answer_status'] === 'complete') {
        publicOutput['learning'] = {
          status: knowledgeDemandId
            ? await getKnowledgeDemandLearningStatus(
                dependencies.database,
                knowledgeDemandId,
              ).catch(() => 'unavailable' as const)
            : 'not_required'
        }
      }
      await recordPublicUsage(
        dependencies.database,
        toolName,
        usageOutcome,
        performance.now() - startedAt,
      ).catch((error: unknown) => {
        dependencies.logger.warn(
          { err: error, requestId: dependencies.requestId, tool: toolName },
          'Public usage aggregation failed',
        )
      })
      await recordMcpRequest(dependencies.database, {
        requestId: dependencies.requestId,
        clientAddress: dependencies.clientAddress,
        actor: dependencies.actor,
        toolName,
        request: input,
        response: publicOutput,
        outcome: usageOutcome,
        durationMs: performance.now() - startedAt,
        knowledgeDemandId
      }).catch((error: unknown) => {
        dependencies.logger.warn(
          { err: error, requestId: dependencies.requestId, tool: toolName },
          'Public MCP request journal write failed',
        )
      })
      return textAndStructured(output as Record<string, unknown>)
    } catch (error) {
      stopTimer({ outcome: 'error' })
      const publicError = publicToolError(error)
      const errorMessage = error instanceof Error ? error.message : null
      const errorOutcome =
        errorMessage === 'RATE_LIMITED' ? 'rate_limited' as const : 'error' as const
      await recordPublicUsage(
        dependencies.database,
        toolName,
        errorOutcome,
        performance.now() - startedAt,
      ).catch(() => undefined)
      await recordMcpRequest(dependencies.database, {
        requestId: dependencies.requestId,
        clientAddress: dependencies.clientAddress,
        actor: dependencies.actor,
        toolName,
        request: input,
        response: publicError,
        outcome: errorOutcome,
        durationMs: performance.now() - startedAt,
        errorCode:
          errorMessage && /^[A-Z][A-Z0-9_]{2,63}$/.test(errorMessage)
            ? errorMessage
            : 'INTERNAL_ERROR',
        retryable: isTransientDatabaseError(error)
      }).catch(() => undefined)
      dependencies.logger.warn(
        { err: error, requestId: dependencies.requestId, tool: toolName },
        'Public MCP tool failed',
      )
      return publicError
    }
  }
}

export function createPublicMcpServer(
  dependencies: PublicServerDependencies,
): McpServer {
  const server = new McpServer(
    {
      name: 'CliDeck MCP — Network Knowledge',
      version: '0.8.5',
      title: 'CliDeck MCP — Network Knowledge',
      websiteUrl: 'https://clideck.com/software/mcp'
    },
    dependencies.taskStore
      ? {
          taskStore: dependencies.taskStore,
          defaultTaskPollInterval: 3_000,
          capabilities: {
            tasks: {
              list: {},
              cancel: {},
              requests: {
                tools: { call: {} }
              }
            }
          }
        }
      : undefined,
  )

  server.registerTool(
    'list_knowledge_domains',
    {
      title: 'List Knowledge Domains',
      description:
        'List installed, compatible knowledge domain packs and their declared capabilities.',
      inputSchema: listKnowledgeDomainsInputSchema,
      outputSchema: listKnowledgeDomainsOutputSchema,
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    wrapTool(dependencies, 'list_knowledge_domains', async () => ({
      domains: await listKnowledgeDomains(dependencies.database)
    })),
  )

  server.registerTool(
    'describe_knowledge_domain',
    {
      title: 'Describe Knowledge Domain',
      description:
        'Return the context and public-record contracts for one installed knowledge domain.',
      inputSchema: describeKnowledgeDomainInputSchema,
      outputSchema: describeKnowledgeDomainOutputSchema,
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    wrapTool(dependencies, 'describe_knowledge_domain', async (input) =>
      describeKnowledgeDomain(dependencies.database, input.domain_id),
    ),
  )

  server.registerTool(
    'query_domain_knowledge',
    {
      title: 'Query Domain Knowledge',
      description:
        'Run deterministic search in one domain using that pack’s validated context and public-record schema.',
      inputSchema: queryDomainKnowledgeInputSchema,
      outputSchema: queryDomainKnowledgeOutputSchema,
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    wrapTool(dependencies, 'query_domain_knowledge', async (input) => {
      if (input.domain_id === 'network') {
        const parsedContext = networkContextInputSchema.parse(input.context)
        const resolution = await resolveKnowledgeContext(
          dependencies.database,
          parsedContext,
        )
        const result = resolution.context
          ? await searchKnowledgeWithCoverage({
              database: dependencies.database,
              question: input.question,
              context: resolution.context,
              limit: Math.min(20, Math.max(1, input.limit))
            })
          : { answers: [], answerStatus: 'unknown' as const, coverage: [] }
        return {
          domain_id: 'network',
          context: resolution.publicContext,
          answers: result.answers,
          unknown: result.answerStatus === 'unknown',
          answer_status: result.answerStatus,
          coverage: result.coverage,
          next_action: result.answers.length === 0
            ? 'knowledge_not_found' as const
            : 'use_answer' as const
        }
      }
      const result = await searchDomainKnowledge(dependencies.database, {
        domainId: input.domain_id,
        question: input.question,
        context: input.context,
        limit: Math.min(20, Math.max(1, input.limit))
      })
      return {
        domain_id: result.domain_id,
        context: result.context,
        answers: result.records,
        unknown: result.records.length === 0,
        answer_status: result.records.length === 0
          ? 'unknown' as const
          : 'complete' as const,
        coverage: [],
        next_action:
          result.records.length === 0
            ? 'knowledge_not_found' as const
            : 'use_answer' as const
      }
    }),
  )

  server.registerTool(
    'resolve_network_context',
    {
      title: 'Resolve Network Context',
      description:
        'Resolve vendor, model/platform, portable software family, operating system, and version context.',
      inputSchema: networkContextInputSchema,
      outputSchema: resolvedNetworkContextSchema,
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    wrapTool(dependencies, 'resolve_network_context', async (input) => {
      const resolved = await resolveNetworkContext(dependencies.database, input)
      return publicNetworkContext(resolved)
    }),
  )

  server.registerTool(
    'query_network_knowledge',
    {
      title: 'Query Network Knowledge',
      description:
        'Return deterministic, version-scoped commands, diagnostics, and concepts for a network question.',
      inputSchema: queryKnowledgeInputSchema,
      outputSchema: knowledgeSearchResultSchema,
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    wrapTool(dependencies, 'query_network_knowledge', async (input) => {
      const resolution = await resolveKnowledgeContext(
        dependencies.database,
        input.context,
      )
      const result = resolution.context
        ? await searchKnowledgeWithCoverage({
            database: dependencies.database,
            question: input.question,
            context: resolution.context,
            limit: Math.min(5, Math.max(1, input.limit))
          })
        : { answers: [], answerStatus: 'unknown' as const, coverage: [] }
      return {
        context: resolution.publicContext,
        answers: result.answers,
        unknown: result.answerStatus === 'unknown',
        answer_status: result.answerStatus,
        coverage: result.coverage,
        next_action:
          result.answers.length === 0
            ? 'request_expert_answer' as const
            : 'use_answer' as const
      }
    }),
  )

  server.registerTool(
    'get_network_workflow',
    {
      title: 'Get Network Workflow',
      description:
        'Return a deterministic, ordered workflow including safety, verification, and rollback.',
      inputSchema: getWorkflowInputSchema,
      outputSchema: knowledgeSearchResultSchema,
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    wrapTool(dependencies, 'get_network_workflow', async (input) => {
      const resolution = await resolveKnowledgeContext(
        dependencies.database,
        input.context,
      )
      const result = resolution.context
        ? await searchKnowledgeWithCoverage({
            database: dependencies.database,
            question: input.goal,
            context: resolution.context,
            limit: Math.min(3, Math.max(1, input.limit)),
            kind: ['workflow', 'change', 'diagnostic'],
            requireAction: true
          })
        : { answers: [], answerStatus: 'unknown' as const, coverage: [] }
      return {
        context: resolution.publicContext,
        answers: result.answers,
        unknown: result.answerStatus === 'unknown',
        answer_status: result.answerStatus,
        coverage: result.coverage,
        next_action:
          result.answers.length === 0
            ? 'request_expert_answer' as const
            : 'use_answer' as const
      }
    }),
  )

  const expertToolConfig = {
    title: 'Request Expert Answer',
    description:
      'Create a durable research task when deterministic knowledge has no applicable answer.',
    inputSchema: requestExpertAnswerInputSchema,
    outputSchema: createdTaskStatusSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true
    }
  } as const
  const enforceExpertLimit = async () => {
    const rate = await consumeDailyRateLimit(
      dependencies.database,
      dependencies.actor.kind === 'tenant'
        ? dependencies.actor.tenantId
        : dependencies.clientKey,
      'mcp_expert',
      dependencies.config.expertRateLimitPerDay,
    )
    if (!rate.allowed) throw new Error('RATE_LIMITED')
  }

  if (dependencies.taskStore) {
    server.experimental.tasks.registerToolTask(
      'request_expert_answer',
      {
        ...expertToolConfig,
        execution: { taskSupport: 'optional' }
      },
      {
        createTask: async (
          rawInput: unknown,
          extra: CreateTaskRequestHandlerExtra,
        ) => {
          const startedAt = performance.now()
          try {
            await enforceExpertLimit()
            const input = requestExpertAnswerInputSchema.parse(rawInput)
            const task = await extra.taskStore.createTask({
              ttl: dependencies.config.anonymousTaskTtlMinutes * 60_000,
              pollInterval: 3_000
            })
            const expert = await createExpertTask(
              dependencies.database,
              dependencies.config,
              dependencies.actor,
              input.question,
              input.context,
              input.idempotency_key,
              dependencies.actor.kind === 'tenant'
                ? dependencies.actor.tenantId
                : dependencies.clientKey,
            )
            const fallbackResult = textAndStructured(
              expert as Record<string, unknown>,
            )
            await dependencies.taskStore!.linkExpertTask(
              task.taskId,
              expert.task_id,
              fallbackResult,
            )
            await Promise.all([
              recordPublicUsage(
                dependencies.database,
                'request_expert_answer',
                'success',
                performance.now() - startedAt,
              ).catch(() => undefined),
              recordMcpRequest(dependencies.database, {
                requestId: dependencies.requestId,
                clientAddress: dependencies.clientAddress,
                actor: dependencies.actor,
                toolName: 'request_expert_answer',
                request: rawInput,
                response: expert,
                outcome: 'success',
                durationMs: performance.now() - startedAt
              }).catch(() => undefined)
            ])
            return { task }
          } catch (error) {
            const publicError = publicToolError(error)
            await recordMcpRequest(dependencies.database, {
              requestId: dependencies.requestId,
              clientAddress: dependencies.clientAddress,
              actor: dependencies.actor,
              toolName: 'request_expert_answer',
              request: rawInput,
              response: publicError,
              outcome:
                error instanceof Error && error.message === 'RATE_LIMITED'
                  ? 'rate_limited'
                  : 'error',
              durationMs: performance.now() - startedAt,
              errorCode:
                error instanceof Error &&
                /^[A-Z][A-Z0-9_]{2,63}$/.test(error.message)
                  ? error.message
                  : 'INTERNAL_ERROR',
              retryable: isTransientDatabaseError(error)
            }).catch(() => undefined)
            throw error
          }
        },
        getTask: async (
          _input: unknown,
          extra: TaskRequestHandlerExtra,
        ) => extra.taskStore.getTask(extra.taskId),
        getTaskResult: async (
          _input: unknown,
          extra: TaskRequestHandlerExtra,
        ) =>
          CallToolResultSchema.parse(
            await extra.taskStore.getTaskResult(extra.taskId),
          )
      },
    )
  } else {
    server.registerTool(
      'request_expert_answer',
      expertToolConfig,
      wrapTool(dependencies, 'request_expert_answer', async (input) =>
        {
          await enforceExpertLimit()
          return createExpertTask(
            dependencies.database,
            dependencies.config,
            dependencies.actor,
            input.question,
            input.context,
            input.idempotency_key,
            dependencies.actor.kind === 'tenant'
              ? dependencies.actor.tenantId
              : dependencies.clientKey,
          )
        },
      ),
    )
  }

  server.registerTool(
    'get_expert_task',
    {
      title: 'Get Expert Task',
      description: 'Poll an expert research task by opaque ID and access token.',
      inputSchema: taskCredentialsSchema,
      outputSchema: taskStatusSchema,
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    wrapTool(dependencies, 'get_expert_task', async (input) =>
      getExpertTask(
        dependencies.database,
        dependencies.actor,
        input.task_id,
        input.access_token,
      ),
    ),
  )

  server.registerTool(
    'continue_expert_task',
    {
      title: 'Continue Expert Task',
      description: 'Provide bounded additional input requested by the researcher.',
      inputSchema: continueTaskInputSchema,
      outputSchema: taskStatusSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false
      }
    },
    wrapTool(dependencies, 'continue_expert_task', async (input) =>
      continueExpertTask(
        dependencies.database,
        dependencies.actor,
        input.task_id,
        input.access_token,
        input.message,
      ),
    ),
  )

  server.registerTool(
    'cancel_expert_task',
    {
      title: 'Cancel Expert Task',
      description: 'Cancel a non-terminal expert task.',
      inputSchema: taskCredentialsSchema,
      outputSchema: taskStatusSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    wrapTool(dependencies, 'cancel_expert_task', async (input) =>
      cancelExpertTask(
        dependencies.database,
        dependencies.actor,
        input.task_id,
        input.access_token,
      ),
    ),
  )

  server.registerTool(
    'submit_feedback',
    {
      title: 'Submit Feedback',
      description:
        'Submit correctness, freshness, safety, or completeness feedback without including private logs.',
      inputSchema: feedbackInputSchema,
      outputSchema: feedbackOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false
      }
    },
    wrapTool(dependencies, 'submit_feedback', async (input) => {
      if (input.sample_contribution) {
        const rate = await consumeDailyRateLimit(
          dependencies.database,
          dependencies.actor.kind === 'tenant'
            ? dependencies.actor.tenantId
            : dependencies.clientKey,
          'mcp_contribution',
          dependencies.config.contributionRateLimitPerDay,
        )
        if (!rate.allowed) throw new Error('RATE_LIMITED')
      }
      return submitFeedback(
        dependencies.database,
        dependencies.quarantineDatabase,
        dependencies.actor,
        input,
      )
    }),
  )

  server.registerTool(
    'analyze_device_snapshot',
    {
      title: 'Analyze Device Snapshot',
      description:
        'Detect vendor, model, operating system, and version from bounded CLI output while redacting sensitive values. Input is not stored.',
      inputSchema: snapshotAnalysisInputSchema,
      outputSchema: snapshotAnalysisOutputSchema,
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    wrapTool(dependencies, 'analyze_device_snapshot', async (input) =>
      analyzeDeviceSnapshot(input),
    ),
  )

  server.registerTool(
    'review_network_change',
    {
      title: 'Review Network Change',
      description:
        'Deterministic advisory review of commands or a configuration diff. It always returns available guidance and never executes a command.',
      inputSchema: changeReviewInputSchema,
      outputSchema: changeReviewOutputSchema,
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    wrapTool(dependencies, 'review_network_change', async (input) => {
      const resolved = await resolveNetworkContext(
        dependencies.database,
        input.context,
      )
      return reviewNetworkChange(dependencies.database, dependencies.config, {
        ...input,
        context: {
          vendor: resolved.vendor,
          model: resolved.model ?? undefined,
          operating_system: resolved.operating_system,
          version: resolved.version ?? undefined
        }
      })
    }),
  )

  server.registerTool(
    'verify_network_change',
    {
      title: 'Verify Network Change',
      description:
        'Evaluate bounded before/after outputs against the signed verification plan returned by review_network_change.',
      inputSchema: changeVerificationInputSchema,
      outputSchema: changeVerificationOutputSchema,
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    wrapTool(dependencies, 'verify_network_change', async (input) =>
      verifyNetworkChange(dependencies.database, dependencies.config, input),
    ),
  )

  server.registerTool(
    'advise_network_upgrade',
    {
      title: 'Advise Network Upgrade',
      description:
        'Return exact-model, exact-version upgrade prerequisites, risks, checks, and rollback without downloading software.',
      inputSchema: upgradeAdvisorInputSchema,
      outputSchema: upgradeAdvisorOutputSchema,
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    wrapTool(dependencies, 'advise_network_upgrade', async (input) =>
      adviseNetworkUpgrade(input),
    ),
  )

  server.registerTool(
    'analyze_network_path',
    {
      title: 'Analyze Network Path',
      description:
        'Build a bounded topology and packet-path graph from supplied CDP, LLDP, route, and traceroute outputs without storing them.',
      inputSchema: networkPathInputSchema,
      outputSchema: networkPathOutputSchema,
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    wrapTool(dependencies, 'analyze_network_path', async (input) =>
      analyzeNetworkPath(input),
    ),
  )

  return server
}
