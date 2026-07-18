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
import { searchKnowledge } from '../domain/knowledge.js'
import {
  cancelExpertTask,
  continueExpertTask,
  createExpertTask,
  getExpertTask,
  submitFeedback
} from '../domain/tasks.js'
import {
  continueTaskInputSchema,
  createdTaskStatusSchema,
  feedbackInputSchema,
  feedbackOutputSchema,
  getWorkflowInputSchema,
  knowledgeSearchResultSchema,
  networkContextInputSchema,
  queryKnowledgeInputSchema,
  requestExpertAnswerInputSchema,
  resolvedNetworkContextSchema,
  taskCredentialsSchema,
  taskStatusSchema
} from '../domain/schemas.js'
import { publicToolError, textAndStructured } from './result.js'
import { PostgresTaskStore } from './postgres-task-store.js'

type PublicServerDependencies = {
  config: AppConfig
  database: Database
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
    const stopTimer = dependencies.metrics.toolDuration.startTimer({
      tool: toolName
    })
    try {
      const output = await operation(input)
      stopTimer({ outcome: 'success' })
      return textAndStructured(output as Record<string, unknown>)
    } catch (error) {
      stopTimer({ outcome: 'error' })
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
      version: '0.1.0',
      title: 'CliDeck MCP — Network Knowledge',
      websiteUrl: 'https://clideck.com'
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
        createExpertTask(
          dependencies.database,
          dependencies.config,
          dependencies.actor,
          input.question,
          input.context,
        ),
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
    wrapTool(dependencies, 'submit_feedback', async (input) =>
      submitFeedback(dependencies.database, dependencies.actor, input),
    ),
  )

  return server
}
