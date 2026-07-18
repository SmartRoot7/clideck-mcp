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
  processNextCandidate
} from '../src/domain/publication.js'
import {
  createExpertTask,
  getExpertTask
} from '../src/domain/tasks.js'
import { createLogger } from '../src/logger.js'
import {
  createTestConfig,
  integrationDatabaseUrl
} from './helpers.js'

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
