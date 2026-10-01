import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { afterAll, describe, expect, it } from 'vitest'
import type { Database } from '../src/db.js'
import { resolveNetworkContext } from '../src/domain/context.js'
import { searchKnowledge } from '../src/domain/knowledge.js'
import { createKnowledgeRevision, publishKnowledgeBatch } from '../src/domain/publication.js'
import { sha256Label } from '../src/crypto.js'
import { integrationDatabaseUrl } from './helpers.js'

const describeIntegration = integrationDatabaseUrl ? describe : describe.skip

describeIntegration('OpenAI publication search regressions', () => {
  const database = new pg.Pool({ connectionString: integrationDatabaseUrl })
  afterAll(async () => { await database.end() })

  it('retrieves interface state with provenance wording but excludes incidental recovery checks', async () => {
    const client = await database.connect()
    try {
      await client.query('BEGIN')
      const key = `test.recovery-${randomUUID()}`
      const recovery = await createKnowledgeRevision(client, {
        stable_key: key,
        kind: 'workflow', vendor_slug: 'cisco', platform_slug: 'catalyst-9000',
        operating_system_slug: 'ios-xe', software_family_slug: 'cisco-ios-xe',
        applicability_scope: 'model', version_scope: 'unbounded',
        title: 'Recover a password on a modular chassis with dual supervisors',
        summary: 'Isolate the active supervisor and perform ROMMON password recovery.',
        question_patterns: ['How do I verify that an interface is operational?', 'Recover a password on dual supervisors'],
        procedure: ['Power off the chassis.', 'Recover the password in ROMMON.', 'Verify that the interface and supervisors are operational.'],
        prerequisites: ['Authorized maintenance window and console access.'],
        risks: ['Service disruption and credential changes.'],
        verification: ['Check restored redundancy.'],
        rollback: ['Follow the approved recovery plan.'],
        limitations: ['Fixture; no device commands are executed.'],
        dangerous: true, risk_level: 'credential_sensitive', confidence: 0.99, quality_score: 0.99,
        confidence_reason: 'Regression fixture reproduces incidental operational check words.',
        last_verified_at: '2026-10-01',
        provenance: [{ url: 'https://www.cisco.com/c/en/us/test/recovery-fixture.html',
          document_type: 'configuration_guide', title: 'Recovery test fixture',
          verified_at: '2026-10-01', content_hash: sha256Label(key),
          evidence_fragment: 'Password recovery with incidental interface verification.',
          evidence_role: 'primary' }]
      }, 'super_admin')
      await publishKnowledgeBatch(client, [recovery], 'Search regression fixture', 'integration-test')
      const context = await resolveNetworkContext(client as unknown as Database, {
        vendor: 'Cisco', model: 'Catalyst 9300', operating_system: 'IOS XE', version: '17.12.4'
      })
      for (const question of [
        'How do I verify that an interface is operational on a Cisco Catalyst 9300 running IOS XE 17.12.4?',
        'Find interface operational-state guidance for Cisco Catalyst 9300, IOS XE 17.12.4, and show the source metadata for the returned active revision.'
      ]) {
        const answers = await searchKnowledge(client as unknown as Database, question, context, 10)
        expect(answers.some(answer => answer.title === 'Verify an interface is operational')).toBe(true)
        expect(answers.some(answer => answer.title === 'Recover a password on a modular chassis with dual supervisors')).toBe(false)
      }
      // Executable steps remain searchable even when a structured change
      // contract has no command_text and uses a human-readable title.
      for (const commandTemplate of [
        'interface <interface> shutdown',
        'interface <interface> no shutdown',
        'interface <interface> ip access-group <name> in|out',
        'logging host <address>'
      ]) {
        const changes = await searchKnowledge(client as unknown as Database,
          commandTemplate, context, 3)
        expect(changes.length).toBeGreaterThan(0)
      }
      const targetedRecovery = await searchKnowledge(client as unknown as Database,
        'Recover a password on a modular chassis with dual supervisors', context, 10)
      expect(targetedRecovery.some(answer => answer.title === 'Recover a password on a modular chassis with dual supervisors' && answer.dangerous)).toBe(true)
    } finally {
      await client.query('ROLLBACK')
      client.release()
    }
  })
})
