import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js'
import type {
  CreateTaskRequestHandlerExtra,
  TaskRequestHandlerExtra
} from '@modelcontextprotocol/sdk/experimental/tasks/interfaces.js'

import type { AppConfig } from '../config.js'
import type { Database } from '../db.js'
import type { Logger } from '../logger.js'
import type { Metrics } from '../metrics.js'
import type { PublicActor } from '../domain/auth.js'
import {
  resolveNetworkContext
} from '../domain/context.js'
import {
  reviewNetworkChange,
  verifyNetworkChange
} from '../domain/change.js'
import { searchKnowledge } from '../domain/knowledge.js'
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
  logger: Logger
  metrics: Metrics
  actor: PublicActor
  requestId: string
  taskStore?: PostgresTaskStore
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
      const output = await operation(input)
      stopTimer({ outcome: 'success' })
      const publicOutput = output as Record<string, unknown>
      const usageOutcome =
        publicOutput['unknown'] === true ||
        publicOutput['status'] === 'unknown' ||
        publicOutput['decision'] === 'unknown'
          ? 'unknown'
          : publicOutput['decision'] === 'blocked'
            ? 'blocked'
            : 'success'
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
      return textAndStructured(output as Record<string, unknown>)
    } catch (error) {
      stopTimer({ outcome: 'error' })
      await recordPublicUsage(
        dependencies.database,
        toolName,
        'error',
        performance.now() - startedAt,
      ).catch(() => undefined)
      dependencies.logger.warn(
        { err: error, requestId: dependencies.requestId, tool: toolName },
        'Public MCP tool failed',
      )
      return publicToolError(error)
    }
  }
}

export function createPublicMcpServer(
  dependencies: PublicServerDependencies,
): McpServer {
  const server = new McpServer(
    {
      name: 'CliDeck MCP — Network Knowledge',
      version: '0.2.0',
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
    'resolve_network_context',
    {
      title: 'Resolve Network Context',
      description:
        'Resolve vendor, model/platform, network operating system, and vendor-specific version context.',
      inputSchema: networkContextInputSchema,
      outputSchema: resolvedNetworkContextSchema,
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    wrapTool(dependencies, 'resolve_network_context', async (input) => {
      const { vendorId, platformId, operatingSystemId, ...publicContext } =
        await resolveNetworkContext(dependencies.database, input)
      return publicContext
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
      const context = await resolveNetworkContext(
        dependencies.database,
        input.context,
      )
      const answers = await searchKnowledge(
        dependencies.database,
        input.question,
        context,
        input.limit,
      )
      const {
        vendorId: _vendorId,
        platformId: _platformId,
        operatingSystemId: _operatingSystemId,
        ...publicContext
      } = context
      return {
        context: publicContext,
        answers,
        unknown: answers.length === 0,
        next_action:
          answers.length === 0 ? 'request_expert_answer' as const : 'use_answer' as const
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
      const context = await resolveNetworkContext(
        dependencies.database,
        input.context,
      )
      const answers = await searchKnowledge(
        dependencies.database,
        input.goal,
        context,
        input.limit,
        'workflow',
      )
      const {
        vendorId: _vendorId,
        platformId: _platformId,
        operatingSystemId: _operatingSystemId,
        ...publicContext
      } = context
      return {
        context: publicContext,
        answers,
        unknown: answers.length === 0,
        next_action:
          answers.length === 0 ? 'request_expert_answer' as const : 'use_answer' as const
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
          )
          const fallbackResult = textAndStructured(
            expert as Record<string, unknown>,
          )
          await dependencies.taskStore!.linkExpertTask(
            task.taskId,
            expert.task_id,
            fallbackResult,
          )
          return { task }
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
        'Fail-closed deterministic review of IOS-XE commands or a configuration diff. It never executes a command.',
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
      if (
        resolved.vendor_slug !== 'cisco' ||
        resolved.operating_system_slug !== 'ios-xe'
      ) {
        return {
          decision: 'unknown' as const,
          risk_level: 'critical' as const,
          blast_radius: [],
          matched_rules: [],
          unknown_commands: input.commands ?? [],
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
        }
      }
      return reviewNetworkChange(dependencies.config, {
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
      verifyNetworkChange(dependencies.config, input),
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
