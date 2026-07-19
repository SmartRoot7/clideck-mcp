import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import {
  constantTimeTokenEquals,
  createPublicTaskId,
  randomUrlToken,
  sha256Label
} from '../src/crypto.js'
import {
  assertSafeProvenanceUrl,
  isBlockedAddress
} from '../src/security/url-policy.js'
import { purgeExpiredSourceArtifacts } from '../src/domain/pipeline-worker.js'
import { createApiApp } from '../src/http/api-app.js'
import { isTrustedProxy } from '../src/http/security.js'
import { createLogger } from '../src/logger.js'
import { createMetrics } from '../src/metrics.js'
import type { Database } from '../src/db.js'
import { createTestConfig } from './helpers.js'

describe('security primitives', () => {
  it('keeps continuous pipeline objects in the production grant matrix', async () => {
    const grants = await readFile(
      resolve(process.cwd(), 'ops/sql/grants.sql'),
      'utf8',
    )
    for (const table of [
      'coverage_targets',
      'source_candidates',
      'source_artifacts',
      'source_fragments',
      'pipeline_settings',
      'pipeline_tasks',
      'pipeline_events',
      'knowledge_candidates',
      'candidate_verifications',
      'agent_runs',
      'legacy_revision_metadata',
      'admin_audit_events'
    ]) {
      expect(grants).toContain(table)
    }
    for (const role of [
      'clideck_mcp_admin',
      'clideck_mcp_worker',
      'clideck_mcp_researcher'
    ]) {
      expect(grants).toContain(`TO ${role};`)
    }
    expect(grants).toMatch(
      /GRANT SELECT ON[\s\S]*knowledge_revisions,[\s\S]*TO clideck_mcp_api;/,
    )
    expect(grants).toMatch(
      /GRANT SELECT ON[\s\S]*task_artifacts[\s\S]*TO clideck_mcp_researcher;/,
    )
    expect(grants).toMatch(
      /GRANT UPDATE ON[\s\S]*source_fragments,[\s\S]*TO clideck_mcp_admin;/,
    )
    expect(grants).toMatch(
      /GRANT UPDATE ON[\s\S]*agent_runs[\s\S]*TO clideck_mcp_admin;/,
    )
  })

  it('creates non-enumerable public identifiers and hashes', () => {
    const first = createPublicTaskId()
    const second = createPublicTaskId()
    expect(first).toMatch(/^ekt_[A-Za-z0-9_-]{32}$/)
    expect(second).not.toBe(first)
    expect(randomUrlToken(32)).toHaveLength(43)
    expect(sha256Label('fact')).toMatch(/^sha256:[0-9a-f]{64}$/)
  })

  it('compares bearer tokens without plaintext equality', () => {
    expect(constantTimeTokenEquals('same-token', 'same-token')).toBe(true)
    expect(constantTimeTokenEquals('first-token', 'second-token')).toBe(false)
  })

  it('blocks private and reserved provenance destinations', async () => {
    for (const address of [
      '127.0.0.1',
      '10.0.0.1',
      '169.254.169.254',
      '192.168.1.1',
      '::1',
      'fd00::1',
      'fec0::1',
      'ff02::1',
      '::127.0.0.1',
      '::ffff:127.0.0.1',
      '::ffff:7f00:1'
    ]) {
      expect(isBlockedAddress(address)).toBe(true)
    }
    await expect(
      assertSafeProvenanceUrl('https://127.0.0.1/manual'),
    ).rejects.toThrow('UNSAFE_PROVENANCE_URL')
    await expect(
      assertSafeProvenanceUrl('http://example.com/manual'),
    ).rejects.toThrow('UNSAFE_PROVENANCE_URL')
  })

  it('trusts only explicitly configured proxy ranges', () => {
    expect(isTrustedProxy('127.0.0.1', ['127.0.0.1/32'])).toBe(true)
    expect(isTrustedProxy('10.0.0.1', ['127.0.0.1/32'])).toBe(false)
  })

  it('collapses arbitrary 404 paths into one metrics label', async () => {
    const config = createTestConfig()
    const database = {
      query: async () => {
        throw new Error('A not-found request must not query the database')
      }
    } as unknown as Database
    const metrics = createMetrics()
    const app = createApiApp({
      config,
      database,
      adminDatabase: database,
      quarantineDatabase: database,
      logger: createLogger(config),
      metrics
    })
    await Promise.all(
      Array.from({ length: 50 }, (_, index) =>
        app.request(`http://localhost/not-found-${index}`),
      ),
    )
    const family = (await metrics.registry.getMetricsAsJSON()).find(
      (metric) => metric.name === 'clideck_mcp_http_requests_total',
    )
    const unmatched = family?.values.filter(
      (sample) => sample.labels['route'] === '__unmatched__',
    )
    expect(unmatched).toHaveLength(1)
  })

  it('does not mark an artifact purged when file deletion fails', async () => {
    const statements: string[] = []
    const database = {
      query: async (sql: string) => {
        statements.push(sql)
        return sql.includes('FROM source_artifacts')
          ? {
              rows: [{
                id: '11111111-1111-4111-8111-111111111111',
                storage_path: '/tmp/undeletable-source',
                extracted_text_path: null
              }]
            }
          : { rows: [] }
      }
    } as unknown as Database
    const removeFile = async () => {
      throw Object.assign(new Error('permission denied'), { code: 'EACCES' })
    }

    await expect(purgeExpiredSourceArtifacts(
      database,
      createLogger(createTestConfig()),
      removeFile,
    )).resolves.toBe(0)
    expect(statements.some((sql) =>
      sql.includes("SET status = 'purged'"),
    )).toBe(false)
  })
})
