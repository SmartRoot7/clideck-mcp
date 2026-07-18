import pino from 'pino'

import type { AppConfig } from './config.js'

export function createLogger(config: AppConfig) {
  return pino({
    level: config.logLevel,
    base: {
      service: 'clideck-mcp',
      environment: config.nodeEnv
    },
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'authorization',
        'cookie',
        'token',
        '*.token',
        'accessToken',
        'access_token',
        'leaseToken',
        'lease_token',
        'snapshot',
        '*.snapshot',
        'before_snapshot',
        'after_snapshot',
        'config_diff',
        'sanitized_payload',
        '*.sanitized_payload',
        'password',
        '*.password',
        'databaseUrl',
        'evidenceFragment',
        'evidence_fragment'
      ],
      censor: '[REDACTED]'
    }
  })
}

export type Logger = ReturnType<typeof createLogger>
