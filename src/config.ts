import { z } from 'zod'

const booleanString = z
  .enum(['true', 'false'])
  .transform((value) => value === 'true')

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),
  API_HOST: z.string().min(1).default('127.0.0.1'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(8787),
  ADMIN_UI_HOST: z.string().min(1).default('127.0.0.1'),
  ADMIN_UI_PORT: z.coerce.number().int().min(1).max(65535).default(8790),
  ADMIN_UI_USERNAME: z.string().trim().min(1).max(128).default('admin'),
  ADMIN_UI_PASSWORD_HASH: z.string().min(32).optional(),
  ADMIN_UI_SESSION_SECRET: z.string().min(32).optional(),
  ADMIN_UI_ACTOR_ID: z.uuid().optional(),
  ADMIN_UI_ALLOWED_ORIGINS: z.string().default(
    'https://clideck-mcp.lan,http://127.0.0.1:5173',
  ),
  ADMIN_UI_SESSION_HOURS: z.coerce.number().int().min(1).max(72).default(12),
  ADMIN_UI_ASSET_ROOT: z.string().min(1).default('./dist-admin'),
  RESEARCHER_HOST: z.string().min(1).default('127.0.0.1'),
  RESEARCHER_PORT: z.coerce.number().int().min(1).max(65535).default(8788),
  DATABASE_URL: z.string().url().startsWith('postgresql://'),
  ADMIN_DATABASE_URL: z.string().url().startsWith('postgresql://').optional(),
  WORKER_DATABASE_URL: z.string().url().startsWith('postgresql://').optional(),
  RESEARCHER_DATABASE_URL: z.string().url().startsWith('postgresql://').optional(),
  QUARANTINE_DATABASE_URL: z.string().url().startsWith('postgresql://').optional(),
  DATABASE_MAX_CONNECTIONS: z.coerce.number().int().min(2).max(50).default(12),
  DATABASE_SSL_MODE: z.enum(['disable', 'verify-full']).default('disable'),
  ADMIN_TOKEN: z.string().min(32).optional(),
  CLIDECK_MCP_ADMIN_ACTOR_HMAC_SECRET: z.string().min(32).optional(),
  RESEARCHER_TOKEN: z.string().min(32).optional(),
  PLAYGROUND_TOKEN: z.string().min(32).optional(),
  VERIFICATION_SIGNING_KEY: z.string().min(32).optional(),
  PUBLIC_BASE_URL: z.string().url().default('http://127.0.0.1:8787'),
  DEPLOY_COMMIT_SHA: z.preprocess(
    (value) => value === '' ? undefined : value,
    z.string().regex(/^[0-9a-f]{40}$/).optional(),
  ),
  TRUSTED_PROXY_CIDRS: z.string().default('127.0.0.1/32,::1/128'),
  ANONYMOUS_TASK_TTL_MINUTES: z.coerce.number().int().min(5).max(1440).default(60),
  TASK_LEASE_SECONDS: z.coerce.number().int().min(30).max(900).default(120),
  PUBLIC_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).max(10000).default(60),
  HEAVY_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).max(1000).default(10),
  EXPERT_RATE_LIMIT_PER_DAY: z.coerce.number().int().min(1).max(100).default(3),
  CONTRIBUTION_RATE_LIMIT_PER_DAY: z.coerce.number().int().min(1).max(100).default(3),
  ADMIN_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).max(1000)
    .default(300),
  MAX_REQUEST_BYTES: z.coerce.number().int().min(1024).max(1048576).default(65536),
  WORKER_POLL_MS: z.coerce.number().int().min(250).max(60000).default(2000),
  SOURCE_STORAGE_DIR: z.string().min(1).default('./var/source-artifacts'),
  SOURCE_MAX_BYTES: z.coerce.number().int().min(1024).max(104857600)
    .default(104857600),
  SOURCE_RETENTION_DAYS: z.coerce.number().int().min(1).max(90).default(30),
  PIPELINE_FRAGMENT_BATCH_SIZE: z.coerce.number().int().min(1).max(32)
    .default(8),
  AUTO_PUBLISH_CONFIDENCE: z.coerce.number().min(0.5).max(1).default(0.9),
  DANGEROUS_AUTO_PUBLISH_CONFIDENCE: z.coerce.number().min(0.5).max(1).default(0.95),
  ENABLE_NATIVE_MCP_TASKS: booleanString.default(false),
  ENABLE_PLAYGROUND: booleanString.default(false),
  ENABLE_PUBLIC_DEMO: booleanString.default(false),
  ENABLE_REMOTE_ADMIN_API: booleanString.default(true)
})

export type AppConfig = {
  nodeEnv: 'development' | 'test' | 'production'
  logLevel: z.infer<typeof envSchema>['LOG_LEVEL']
  api: { host: string; port: number }
  adminUi: {
    host: string
    port: number
    username: string
    passwordHash: string
    sessionSecret: string
    actorId: string
    allowedOrigins: string[]
    sessionHours: number
    assetRoot: string
  }
  researcher: { host: string; port: number }
  databaseUrl: string
  adminDatabaseUrl: string
  workerDatabaseUrl: string
  researcherDatabaseUrl: string
  quarantineDatabaseUrl: string
  databaseMaxConnections: number
  databaseSslMode: 'disable' | 'verify-full'
  adminToken: string
  adminActorHmacSecret: string
  researcherToken: string
  playgroundToken: string
  verificationSigningKey: string
  publicBaseUrl: string
  deployCommitSha: string | null
  trustedProxyCidrs: string[]
  anonymousTaskTtlMinutes: number
  taskLeaseSeconds: number
  publicRateLimitPerMinute: number
  heavyRateLimitPerMinute: number
  expertRateLimitPerDay: number
  contributionRateLimitPerDay: number
  adminRateLimitPerMinute: number
  maxRequestBytes: number
  workerPollMs: number
  sourceStorageDir: string
  sourceMaxBytes: number
  sourceRetentionDays: number
  pipelineFragmentBatchSize: number
  autoPublishConfidence: number
  dangerousAutoPublishConfidence: number
  enableNativeMcpTasks: boolean
  enablePlayground: boolean
  enablePublicDemo: boolean
  enableRemoteAdminApi: boolean
}

let cachedConfig: AppConfig | undefined

export function getConfig(
  environment: NodeJS.ProcessEnv = process.env,
): AppConfig {
  if (environment === process.env && cachedConfig) return cachedConfig

  const parsed = envSchema.parse(environment)
  const config: AppConfig = {
    nodeEnv: parsed.NODE_ENV,
    logLevel: parsed.LOG_LEVEL,
    api: { host: parsed.API_HOST, port: parsed.API_PORT },
    adminUi: {
      host: parsed.ADMIN_UI_HOST,
      port: parsed.ADMIN_UI_PORT,
      username: parsed.ADMIN_UI_USERNAME,
      passwordHash: parsed.ADMIN_UI_PASSWORD_HASH ?? '',
      sessionSecret: parsed.ADMIN_UI_SESSION_SECRET ?? '',
      actorId: parsed.ADMIN_UI_ACTOR_ID ?? '',
      allowedOrigins: parsed.ADMIN_UI_ALLOWED_ORIGINS.split(',')
        .map((value) => value.trim())
        .filter(Boolean),
      sessionHours: parsed.ADMIN_UI_SESSION_HOURS,
      assetRoot: parsed.ADMIN_UI_ASSET_ROOT
    },
    researcher: {
      host: parsed.RESEARCHER_HOST,
      port: parsed.RESEARCHER_PORT
    },
    databaseUrl: parsed.DATABASE_URL,
    adminDatabaseUrl: parsed.ADMIN_DATABASE_URL ?? parsed.DATABASE_URL,
    workerDatabaseUrl: parsed.WORKER_DATABASE_URL ?? parsed.DATABASE_URL,
    researcherDatabaseUrl:
      parsed.RESEARCHER_DATABASE_URL ?? parsed.DATABASE_URL,
    quarantineDatabaseUrl:
      parsed.QUARANTINE_DATABASE_URL ?? parsed.DATABASE_URL,
    databaseMaxConnections: parsed.DATABASE_MAX_CONNECTIONS,
    databaseSslMode: parsed.DATABASE_SSL_MODE,
    adminToken: parsed.ADMIN_TOKEN ?? '',
    adminActorHmacSecret:
      parsed.CLIDECK_MCP_ADMIN_ACTOR_HMAC_SECRET ?? '',
    researcherToken: parsed.RESEARCHER_TOKEN ?? '',
    playgroundToken: parsed.PLAYGROUND_TOKEN ?? '',
    verificationSigningKey:
      parsed.VERIFICATION_SIGNING_KEY ?? parsed.ADMIN_TOKEN ?? '',
    publicBaseUrl: parsed.PUBLIC_BASE_URL,
    deployCommitSha: parsed.DEPLOY_COMMIT_SHA ?? null,
    trustedProxyCidrs: parsed.TRUSTED_PROXY_CIDRS.split(',')
      .map((value) => value.trim())
      .filter(Boolean),
    anonymousTaskTtlMinutes: parsed.ANONYMOUS_TASK_TTL_MINUTES,
    taskLeaseSeconds: parsed.TASK_LEASE_SECONDS,
    publicRateLimitPerMinute: parsed.PUBLIC_RATE_LIMIT_PER_MINUTE,
    heavyRateLimitPerMinute: parsed.HEAVY_RATE_LIMIT_PER_MINUTE,
    expertRateLimitPerDay: parsed.EXPERT_RATE_LIMIT_PER_DAY,
    contributionRateLimitPerDay: parsed.CONTRIBUTION_RATE_LIMIT_PER_DAY,
    adminRateLimitPerMinute: parsed.ADMIN_RATE_LIMIT_PER_MINUTE,
    maxRequestBytes: parsed.MAX_REQUEST_BYTES,
    workerPollMs: parsed.WORKER_POLL_MS,
    sourceStorageDir: parsed.SOURCE_STORAGE_DIR,
    sourceMaxBytes: parsed.SOURCE_MAX_BYTES,
    sourceRetentionDays: parsed.SOURCE_RETENTION_DAYS,
    pipelineFragmentBatchSize: parsed.PIPELINE_FRAGMENT_BATCH_SIZE,
    autoPublishConfidence: parsed.AUTO_PUBLISH_CONFIDENCE,
    dangerousAutoPublishConfidence:
      parsed.DANGEROUS_AUTO_PUBLISH_CONFIDENCE,
    enableNativeMcpTasks: parsed.ENABLE_NATIVE_MCP_TASKS,
    enablePlayground: parsed.ENABLE_PLAYGROUND,
    enablePublicDemo: parsed.ENABLE_PUBLIC_DEMO,
    enableRemoteAdminApi: parsed.ENABLE_REMOTE_ADMIN_API
  }

  if (environment === process.env) cachedConfig = config
  return config
}

export function resetConfigForTests(): void {
  cachedConfig = undefined
}

export function requireRuntimeSecret(
  name:
    | 'ADMIN_TOKEN'
    | 'CLIDECK_MCP_ADMIN_ACTOR_HMAC_SECRET'
    | 'RESEARCHER_TOKEN'
    | 'PLAYGROUND_TOKEN'
    | 'VERIFICATION_SIGNING_KEY'
    | 'ADMIN_UI_SESSION_SECRET',
  value: string,
): void {
  if (value.length < 32) {
    throw new Error(`${name} must be configured with at least 32 characters`)
  }
}
