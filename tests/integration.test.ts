import { randomUUID } from 'node:crypto'

import pg from 'pg'

import { createPublicTaskId, sha256, sha256Label } from '../src/crypto.js'
import {
  resolveNetworkContext
} from '../src/domain/context.js'
import {
  getPublicRevision,
  searchKnowledge
} from '../src/domain/knowledge.js'
import {
  processNextCandidate,
  runWorkerMaintenance
} from '../src/domain/publication.js'
import {
  createExpertTask,
  getExpertTask,
  submitFeedback
} from '../src/domain/tasks.js'
import { createLogger } from '../src/logger.js'
import {
  createTestConfig,
  integrationDatabaseUrl
} from './helpers.js'
import { createApiApp } from '../src/http/api-app.js'
import { createMetrics } from '../src/metrics.js'

const { Pool } = pg
const describeIntegration = integrationDatabaseUrl ? describe : describe.skip

describeIntegration('PostgreSQL integration', () => {
  const config = createTestConfig()
  const database = new Pool({
    connectionString: integrationDatabaseUrl,
    max: 4
  })
  const logger = createLogger(config)

  afterAll(async () => {
    await database.end()
  })

  it('returns known knowledge without private provenance fields', async () => {
    const context = await resolveNetworkContext(database, {
      vendor: 'Cisco',
      model: 'C9300',
      operating_system: 'IOS XE',
      version: '17.9.4'
    })
    const answers = await searchKnowledge(
      database,
      'show ip interface brief',
      context,
      3,
    )
    expect(answers).toHaveLength(1)
    expect(answers[0]?.command).toBe('show ip interface brief')

    const serialized = JSON.stringify(answers)
    for (const privateField of [
      'canonical_url',
      'source_document',
      'evidence_fragment',
      'content_hash',
      'confidence_reason'
    ]) {
      expect(serialized).not.toContain(privateField)
    }

    const revision = await getPublicRevision(
      database,
      answers[0]!.revision_ref,
    )
    expect(revision?.revision_ref).toBe(answers[0]!.revision_ref)
    expect(answers[0]?.assurance.validation_level).toBe(
      'documentation_reviewed',
    )
  })

  it('exposes safe aggregate stats and protects playground operations', async () => {
    const clientKey = `test-client-${randomUUID().replaceAll('-', '')}`
    const app = createApiApp({
      config,
      database,
      adminDatabase: database,
      quarantineDatabase: database,
      logger,
      metrics: createMetrics()
    })
    const statsResponse = await app.request('/public/v1/stats')
    expect(statsResponse.status).toBe(200)
    const stats = await statsResponse.json() as {
      coverage: { published_knowledge: number; device_models: number }
      growth_30d: unknown[]
    }
    expect(stats.coverage.published_knowledge).toBeGreaterThanOrEqual(50)
    expect(stats.coverage.device_models).toBeGreaterThanOrEqual(14)
    expect(stats.growth_30d).toHaveLength(30)

    const unauthorized = await app.request(
      '/public/v1/playground/analyze-snapshot',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          snapshot: 'Cisco IOS XE Software, Version 17.15.5',
          snapshot_type: 'auto',
          redaction_profile: 'strict'
        })
      },
    )
    expect(unauthorized.status).toBe(401)

    const authorized = await app.request(
      '/public/v1/playground/analyze-snapshot',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${config.playgroundToken}`,
          'x-clideck-client-key': clientKey
        },
        body: JSON.stringify({
          snapshot:
            'Cisco IOS XE Software, Version 17.15.5\ncisco C9300-48UXM processor',
          snapshot_type: 'auto',
          redaction_profile: 'strict'
        })
      },
    )
    expect(authorized.status).toBe(200)
    expect(authorized.headers.get('cache-control')).toBe('no-store')

    const oversized = await app.request(
      '/public/v1/playground/analyze-snapshot',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${config.playgroundToken}`,
          'x-clideck-client-key': clientKey
        },
        body: JSON.stringify({
          snapshot: 'x'.repeat(66_000),
          snapshot_type: 'auto',
          redaction_profile: 'strict'
        })
      },
    )
    expect(oversized.status).toBe(413)
  })

  it('enforces anonymous task access tokens and tenant isolation', async () => {
    const anonymousTask = await createExpertTask(
      database,
      config,
      { kind: 'anonymous' },
      'How do I validate an unknown platform behavior?',
      {
        vendor: 'Cisco',
        model: 'C9300',
        operating_system: 'IOS XE',
        version: '17.9.4'
      },
    )
    expect(anonymousTask.access_token).toBeTruthy()
    await expect(
      getExpertTask(
        database,
        { kind: 'anonymous' },
        anonymousTask.task_id,
        'wrong-token-that-is-long-enough-to-be-valid',
      ),
    ).rejects.toThrow('EXPERT_TASK_NOT_FOUND')
    await expect(
      getExpertTask(
        database,
        { kind: 'anonymous' },
        anonymousTask.task_id,
        anonymousTask.access_token,
      ),
    ).resolves.toMatchObject({ task_id: anonymousTask.task_id })

    const firstTenant = await database.query<{ id: string }>(
      `INSERT INTO tenants (slug, display_name)
       VALUES ($1, 'First test tenant')
       RETURNING id`,
      [`test-first-${randomUUID().slice(0, 8)}`],
    )
    const secondTenant = await database.query<{ id: string }>(
      `INSERT INTO tenants (slug, display_name)
       VALUES ($1, 'Second test tenant')
       RETURNING id`,
      [`test-second-${randomUUID().slice(0, 8)}`],
    )
    const tenantTask = await createExpertTask(
      database,
      config,
      {
        kind: 'tenant',
        principalId: randomUUID(),
        tenantId: firstTenant.rows[0]!.id,
        role: 'tenant_client'
      },
      'How do I validate a tenant-scoped unknown behavior?',
      {
        vendor: 'Cisco',
        operating_system: 'IOS XE'
      },
    )
    await expect(
      getExpertTask(
        database,
        {
          kind: 'tenant',
          principalId: randomUUID(),
          tenantId: secondTenant.rows[0]!.id,
          role: 'tenant_client'
        },
        tenantTask.task_id,
        undefined,
      ),
    ).rejects.toThrow('EXPERT_TASK_NOT_FOUND')
  })

  it('re-redacts opted-in samples into the isolated quarantine', async () => {
    const revision = await database.query<{ revision_id: string }>(
      `SELECT revision_id
       FROM public_active_knowledge
       ORDER BY stable_key
       LIMIT 1`,
    )
    const sentinel = `sentinel-${randomUUID()}`
    const result = await submitFeedback(
      database,
      database,
      { kind: 'anonymous' },
      {
        revision_ref: revision.rows[0]!.revision_id,
        category: 'correct',
        sample_contribution: {
          consent: true,
          consent_version: '2026-07-01',
          snapshot_type: 'config',
          sanitized_payload:
            `hostname private-edge\nusername operator password ${sentinel}`,
          detected_context: {
            vendor: 'Cisco',
            hostname: 'hostname private-edge'
          }
        }
      },
    )
    const contribution = await database.query<{
      sanitized_payload: string
      detected_context: Record<string, string>
      status: string
      ttl_days: number
    }>(
      `SELECT
         sanitized_payload,
         detected_context,
         status,
         extract(epoch FROM expires_at - contributed_at) / 86400
           AS ttl_days
       FROM snapshot_contributions
       WHERE id = $1`,
      [result.contribution_id],
    )
    const serialized = JSON.stringify(contribution.rows[0])
    expect(serialized).not.toContain(sentinel)
    expect(serialized).not.toContain('private-edge')
    expect(contribution.rows[0]?.status).toBe('quarantine')
    expect(Number(contribution.rows[0]?.ttl_days)).toBeCloseTo(30, 1)

    await database.query(
      `UPDATE snapshot_contributions
       SET expires_at = now() - interval '1 second'
       WHERE id = $1`,
      [result.contribution_id],
    )
    await runWorkerMaintenance(database, `test-${randomUUID()}`)
    const expired = await database.query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM snapshot_contributions WHERE id = $1
       ) AS exists`,
      [result.contribution_id],
    )
    expect(expired.rows[0]?.exists).toBe(false)
  })

  it('publishes a high-confidence candidate atomically and reuses it', async () => {
    const unique = randomUUID().replaceAll('-', '').slice(0, 12)
    const publicId = createPublicTaskId()
    const task = await database.query<{ id: string }>(
      `INSERT INTO expert_tasks (
         public_id,
         access_token_hash,
         question,
         network_context,
         status,
         expires_at
       )
       VALUES (
         $1,
         $2,
         $3,
         $4::jsonb,
         'validating',
         now() + interval '1 hour'
       )
       RETURNING id`,
      [
        publicId,
        sha256(`test-${unique}`),
        `show test loopback marker ${unique}`,
        JSON.stringify({
          vendor: 'Cisco',
          model: 'C9300',
          operating_system: 'IOS XE',
          version: '17.9.4'
        })
      ],
    )
    const candidate = {
      task_id: publicId,
      stable_key: `cisco.ios-xe.test-loopback-${unique}`,
      kind: 'command',
      vendor_slug: 'cisco',
      platform_slug: 'catalyst-9000',
      operating_system_slug: 'ios-xe',
      version_min: '16.6',
      title: `Show test loopback marker ${unique}`,
      summary: `A deterministic integration-test fact for marker ${unique}.`,
      question_patterns: [`show test loopback marker ${unique}`],
      cli_mode: 'privileged EXEC',
      command: `show test-loopback-${unique}`,
      procedure: [],
      prerequisites: ['Read-only CLI access.'],
      risks: ['Test-only structured knowledge.'],
      verification: ['Confirm the expected marker is present.'],
      rollback: ['No configuration change is made.'],
      limitations: ['Integration-test record.'],
      dangerous: false,
      confidence: 0.96,
      quality_score: 0.95,
      confidence_reason:
        'Structured integration candidate with a bounded, deterministic scope.',
      last_verified_at: '2026-07-17',
      provenance: [{
        url: `https://example.com/network-test/${unique}`,
        document_type: 'integration_test',
        title: `Integration test source ${unique}`,
        verified_at: '2026-07-17',
        content_hash: sha256Label(unique),
        evidence_fragment: `Test evidence for marker ${unique}.`,
        evidence_role: 'primary'
      }]
    }
    await database.query(
      `INSERT INTO task_artifacts (
         task_id, artifact_type, payload, content_hash
       )
       VALUES ($1, 'candidate_revision', $2::jsonb, $3)`,
      [
        task.rows[0]!.id,
        JSON.stringify(candidate),
        sha256Label(JSON.stringify(candidate))
      ],
    )

    await expect(
      processNextCandidate(database, config, logger),
    ).resolves.toBe(true)

    const state = await database.query<{
      status: string
      result_revision_id: string
    }>(
      `SELECT status, result_revision_id
       FROM expert_tasks
       WHERE id = $1`,
      [task.rows[0]!.id],
    )
    expect(state.rows[0]?.status).toBe('completed')

    const context = await resolveNetworkContext(database, {
      vendor: 'Cisco',
      model: 'C9300',
      operating_system: 'IOS XE',
      version: '17.9.4'
    })
    const answers = await searchKnowledge(
      database,
      `show test loopback marker ${unique}`,
      context,
      1,
    )
    expect(answers[0]?.command).toBe(`show test-loopback-${unique}`)
    expect(answers[0]?.revision_ref).toBe(
      state.rows[0]?.result_revision_id,
    )
  })
})
