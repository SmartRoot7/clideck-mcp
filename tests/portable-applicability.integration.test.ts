import { randomUUID } from 'node:crypto'

import pg from 'pg'
import { afterAll, describe, expect, it } from 'vitest'

import type { Database } from '../src/db.js'
import {
  publicNetworkContext,
  resolveNetworkContext
} from '../src/domain/context.js'
import { searchKnowledge } from '../src/domain/knowledge.js'
import {
  queueApproximateKnowledgeDemand
} from '../src/domain/mcp-observability.js'
import {
  createKnowledgeRevision,
  publishKnowledgeBatch
} from '../src/domain/publication.js'
import { sha256Label } from '../src/crypto.js'
import { integrationDatabaseUrl } from './helpers.js'

const { Pool } = pg
const describeIntegration = integrationDatabaseUrl ? describe : describe.skip

describeIntegration('portable software applicability', () => {
  const database = new Pool({ connectionString: integrationDatabaseUrl })

  afterAll(async () => {
    await database.end()
  })

  it('reuses ONIE OS-family knowledge across vendors and prefers a model overlay', async () => {
    const client = await database.connect()
    const suffix = randomUUID().slice(0, 8)
    try {
      await client.query('BEGIN')
      const openCompute = await client.query<{ id: string }>(
        `INSERT INTO vendors (slug, display_name)
         VALUES ($1, $2) RETURNING id`,
        [`open-compute-${suffix}`, `Open Compute ${suffix}`],
      )
      const dell = await client.query<{ id: string }>(
        `INSERT INTO vendors (slug, display_name)
         VALUES ($1, $2) RETURNING id`,
        [`dell-${suffix}`, `Dell ${suffix}`],
      )
      await client.query(
        `INSERT INTO operating_systems (vendor_id, slug, display_name)
         VALUES ($1, 'onie', 'ONIE')`,
        [openCompute.rows[0]!.id],
      )
      await client.query(
        `INSERT INTO operating_systems (vendor_id, slug, display_name)
         VALUES ($1, 'onie', 'ONIE')`,
        [dell.rows[0]!.id],
      )
      const platform = await client.query<{ id: string }>(
        `INSERT INTO platforms (vendor_id, slug, display_name)
         VALUES ($1, $2, $3)
         RETURNING id`,
        [dell.rows[0]!.id, `s5248f-${suffix}`, `S5248F ${suffix}`],
      )

      const base = {
        kind: 'command' as const,
        operating_system_slug: 'onie',
        version_min: undefined,
        version_max: undefined,
        software_family_slug: 'onie',
        version_scope: 'unbounded' as const,
        portable_key: `onie.inspect-system-${suffix}`,
        title: 'Inspect ONIE system information',
        summary: 'Displays read-only ONIE system information.',
        question_patterns: ['How do I inspect ONIE system information?'],
        cli_mode: 'ONIE shell',
        command: 'onie-sysinfo',
        procedure: [],
        prerequisites: ['Open an ONIE shell.'],
        risks: [],
        verification: ['Confirm that ONIE prints system information.'],
        rollback: [],
        limitations: [],
        dangerous: false,
        risk_level: 'safe_read_only' as const,
        confidence: 0.98,
        quality_score: 0.98,
        confidence_reason:
          'The project-authored fixture directly supports the read-only command.',
        last_verified_at: '2026-07-21'
      }
      const generic = await createKnowledgeRevision(client, {
        ...base,
        stable_key: `test.onie.generic-${suffix}`,
        vendor_slug: `open-compute-${suffix}`,
        applicability_scope: 'os_family',
        provenance: [{
          url: `https://example.com/onie-generic-${suffix}`,
          document_type: 'command_reference',
          title: 'ONIE portable command fixture',
          verified_at: '2026-07-21',
          content_hash: sha256Label(`onie-generic-${suffix}`),
          evidence_fragment: 'onie-sysinfo',
          evidence_role: 'primary' as const
        }]
      }, 'super_admin')
      const overlay = await createKnowledgeRevision(client, {
        ...base,
        stable_key: `test.onie.overlay-${suffix}`,
        vendor_slug: `dell-${suffix}`,
        platform_slug: `s5248f-${suffix}`,
        applicability_scope: 'model',
        provenance: [{
          url: `https://example.com/onie-overlay-${suffix}`,
          document_type: 'command_reference',
          title: 'ONIE model overlay fixture',
          verified_at: '2026-07-21',
          content_hash: sha256Label(`onie-overlay-${suffix}`),
          evidence_fragment: 'onie-sysinfo',
          evidence_role: 'primary' as const
        }]
      }, 'super_admin')
      await publishKnowledgeBatch(
        client,
        [generic, overlay],
        'Portable applicability integration fixture',
        'integration-test',
      )

      const exactContext = await resolveNetworkContext(
        client as unknown as Database,
        {
          vendor: `dell-${suffix}`,
          model: `s5248f-${suffix}`,
          operating_system: 'ONIE'
        },
      )
      const exactAnswers = await searchKnowledge(
        client as unknown as Database,
        'How do I inspect ONIE system information?',
        exactContext,
        5,
      )
      expect(exactAnswers).toHaveLength(1)
      expect(exactAnswers[0]!.command).toBe('onie-sysinfo')
      expect(exactAnswers[0]!.applicability.match_level).toBe('exact_model')
      await client.query(
        `INSERT INTO knowledge_applicability_exclusions (
           revision_id, platform_id, reason
         ) VALUES ($1, $2, $3)`,
        [
          overlay.revisionId,
          platform.rows[0]!.id,
          'The test model overlay is intentionally excluded for validation.'
        ],
      )
      const excludedOverlayAnswers = await searchKnowledge(
        client as unknown as Database,
        'How do I inspect ONIE system information?',
        exactContext,
        5,
      )
      expect(excludedOverlayAnswers).toHaveLength(1)
      expect(excludedOverlayAnswers[0]!.applicability.match_level).toBe(
        'os_family'
      )

      const portableContext = await resolveNetworkContext(
        client as unknown as Database,
        {
          vendor: 'unregistered-whitebox-manufacturer',
          model: 'unknown-switch-model',
          operating_system: 'ONIE'
        },
      )
      const portableAnswers = await searchKnowledge(
        client as unknown as Database,
        'How do I inspect ONIE system information?',
        portableContext,
        5,
      )
      expect(portableContext.vendor_resolved).toBe(false)
      expect(portableAnswers).toHaveLength(1)
      expect(portableAnswers[0]!.command).toBe('onie-sysinfo')
      expect(portableAnswers[0]!.applicability).toMatchObject({
        match_level: 'os_family',
        assurance_level: 'generic',
        requires_platform_confirmation: false
      })
      const gapDemandId = await queueApproximateKnowledgeDemand(
        client as unknown as Database,
        'query_network_knowledge',
        {
          question: 'How do I inspect ONIE system information?',
          context: {
            vendor: 'unregistered-whitebox-manufacturer',
            model: 'unknown-switch-model',
            operating_system: 'ONIE'
          }
        },
        {
          context: publicNetworkContext(portableContext),
          answers: portableAnswers,
          unknown: false,
          next_action: 'use_answer'
        },
      )
      expect(gapDemandId).toBeNull()
      await client.query(
        `INSERT INTO knowledge_applicability_exclusions (
           revision_id, version_min, version_max,
           version_normalized_min, version_normalized_max, reason
         ) VALUES ($1, '2024.11', '2024.11', $2, $2, $3)`,
        [
          generic.revisionId,
          [2024, 11],
          'The exact test release is excluded from portable inheritance.'
        ],
      )
      const versionedContext = await resolveNetworkContext(
        client as unknown as Database,
        {
          vendor: 'unregistered-whitebox-manufacturer',
          operating_system: 'ONIE',
          version: '2024.11'
        },
      )
      expect(await searchKnowledge(
        client as unknown as Database,
        'How do I inspect ONIE system information?',
        versionedContext,
        5,
      )).toHaveLength(0)
      await client.query('ROLLBACK')
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  })
})
