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
import { isTrustedProxy } from '../src/http/security.js'

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
      'fd00::1'
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
})
