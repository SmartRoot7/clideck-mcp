import type { AppConfig } from '../src/config.js'
import { getConfig } from '../src/config.js'

export const integrationDatabaseUrl = process.env['DATABASE_URL']

export function createTestConfig(
  overrides: Partial<AppConfig> = {},
): AppConfig {
  const config = getConfig({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    API_HOST: '127.0.0.1',
    API_PORT: '8787',
    RESEARCHER_HOST: '127.0.0.1',
    RESEARCHER_PORT: '8788',
    DATABASE_URL:
      integrationDatabaseUrl ??
      'postgresql://127.0.0.1:5432/clideck_mcp_test',
    ADMIN_TOKEN: 'test-admin-token-that-is-at-least-32-characters',
    RESEARCHER_TOKEN: 'test-researcher-token-at-least-32-characters',
    ENABLE_NATIVE_MCP_TASKS: 'true'
  })
  return { ...config, ...overrides }
}
