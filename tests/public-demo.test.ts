import { describe, expect, it } from 'vitest'

import {
  REDACTED_SOURCE_IDENTITY,
  sanitizeDemoExpertTasks,
  sanitizeDemoFeedback,
  sanitizeDemoPipeline,
  sanitizeDemoProvenance,
  sanitizeDemoReleases,
  sanitizeDemoSources
} from '../src/domain/public-demo.js'

describe('public demo security projections', () => {
  it('projects normal provenance without source identities or hashes', () => {
    const result = sanitizeDemoProvenance({
      revision_id: 'revision-1',
      status: 'published',
      created_at: '2026-07-19T12:00:00.000Z',
      provenance: [{
        vendor: 'Cisco',
        title: 'Private manual name',
        document_version: '17.15',
        canonical_url: 'https://private.example/manual',
        document_date: '2026-07-01',
        verified_at: '2026-07-19',
        content_hash: 'sha256:private-document',
        evidence_fragment: 'Private source excerpt',
        evidence_role: 'primary',
        confidence_reason: 'Manual Private manual name confirms it.'
      }]
    })

    expect(result).toEqual({
      revision_id: 'revision-1',
      status: 'published',
      created_at: '2026-07-19T12:00:00.000Z',
      provenance: [{
        vendor: 'Cisco',
        title: REDACTED_SOURCE_IDENTITY,
        document_version: '17.15',
        canonical_url: REDACTED_SOURCE_IDENTITY,
        document_date: '2026-07-01',
        verified_at: '2026-07-19',
        content_hash: REDACTED_SOURCE_IDENTITY,
        evidence_fragment: REDACTED_SOURCE_IDENTITY,
        evidence_role: 'primary',
        confidence_reason: REDACTED_SOURCE_IDENTITY
      }]
    })
    expect(JSON.stringify(result)).not.toContain('private')
  })

  it('projects schema-free legacy provenance from a closed field list', () => {
    const result = sanitizeDemoProvenance({
      revision_id: 'revision-legacy',
      status: 'published',
      created_at: '2026-07-19T12:00:00.000Z',
      provenance: {
        origin: 'legacy_import',
        legacy_key: 'private-legacy-key',
        item_type: 'runbook',
        source_trust: 'verified',
        lifecycle_status: 'published',
        original_risk_level: 'low',
        original_confidence: '0.96',
        original_quality_score: '0.94',
        published_at: '2025-02-01T00:00:00.000Z',
        payload_hash: 'sha256:private-payload',
        provenance: {
          source_url: 'https://private.example/manual',
          document: 'Private manual',
          evidence: 'Private evidence',
          href: 'https://private.example/other'
        }
      }
    })

    expect(result.provenance).toEqual({
      origin: 'legacy_import',
      legacy_key: REDACTED_SOURCE_IDENTITY,
      item_type: 'runbook',
      source_trust: 'verified',
      lifecycle_status: 'published',
      original_risk_level: 'low',
      original_confidence: '0.96',
      original_quality_score: '0.94',
      published_at: '2025-02-01T00:00:00.000Z',
      provenance: REDACTED_SOURCE_IDENTITY,
      payload_hash: REDACTED_SOURCE_IDENTITY
    })
    expect(JSON.stringify(result)).not.toContain('private')
    expect(JSON.stringify(result)).not.toContain('source_url')
  })

  it('replaces free-form pipeline text and keeps only safe metadata', () => {
    const pipeline = sanitizeDemoPipeline({
      settings: {},
      tasks: [{
        id: 'pipeline-task',
        source_title: 'Current manual',
        failure_message: 'Parser failed in Old Private Manual',
        result: {
          document_title: 'Private manual',
          credential: 'private-token'
        }
      }],
      events: [{
        id: 'pipeline-event',
        message: 'Published Old Private Manual from private URL',
        metadata: {
          status: 'completed',
          stage: 'publish',
          source_url: 'https://private.example/manual',
          document: 'Old Private Manual',
          credential: 'private-token'
        }
      }]
    } as never)
    const [task] = pipeline.tasks

    expect(task?.source_title).toBe(REDACTED_SOURCE_IDENTITY)
    expect(task?.failure_message).toBe(REDACTED_SOURCE_IDENTITY)
    expect(task?.result).toBeNull()
    expect(pipeline.events[0]?.message).toBe(REDACTED_SOURCE_IDENTITY)
    expect(pipeline.events[0]?.metadata).toEqual({
      status: 'completed',
      stage: 'publish'
    })
    expect(JSON.stringify(pipeline)).not.toContain('private')
  })

  it('removes feedback content and internal task or revision linkage', () => {
    const [row] = sanitizeDemoFeedback([{
      id: 'feedback-id',
      revision_id: 'private-revision-id',
      task_id: 'private-task-id',
      rating: 2,
      category: 'incorrect',
      comment: 'Private user comment with a credential',
      created_at: '2026-07-19T12:00:00.000Z'
    }])

    expect(row).toEqual({
      id: 'feedback-id',
      revision_id: null,
      task_id: null,
      rating: 2,
      category: 'incorrect',
      comment: REDACTED_SOURCE_IDENTITY,
      created_at: '2026-07-19T12:00:00.000Z'
    })
  })

  it('pseudonymizes tenant tasks while preserving public progress', () => {
    const [row] = sanitizeDemoExpertTasks([{
      public_id: 'private-public-task-id',
      tenant_id: 'private-tenant-id',
      status: 'running',
      priority: 10,
      attempts: 1,
      claim_owner: 'private-executor',
      lease_until: '2026-07-19T12:05:00.000Z',
      expires_at: '2026-07-20T12:00:00.000Z',
      created_at: '2026-07-19T12:00:00.000Z',
      updated_at: '2026-07-19T12:01:00.000Z',
      completed_at: null,
      failure_code: 'private_failure',
      failure_message: 'Private manual failed.',
      result_revision_id: 'private-revision-id',
      stage: 'researching',
      progress_percent: 42,
      public_message: 'Researching Private manual',
      result_release_sequence: 17
    }])

    expect(row).toEqual({
      public_id: 'DEMO-TASK-001',
      tenant_id: null,
      status: 'running',
      priority: 10,
      attempts: 1,
      claim_owner: null,
      lease_until: '2026-07-19T12:05:00.000Z',
      expires_at: '2026-07-20T12:00:00.000Z',
      created_at: '2026-07-19T12:00:00.000Z',
      updated_at: '2026-07-19T12:01:00.000Z',
      completed_at: null,
      failure_code: null,
      failure_message: REDACTED_SOURCE_IDENTITY,
      result_revision_id: null,
      stage: 'researching',
      progress_percent: 42,
      public_message: REDACTED_SOURCE_IDENTITY,
      result_release_sequence: null
    })
    expect(JSON.stringify(row)).not.toContain('private')
  })

  it('redacts release reasons and source hashes without changing row shape', () => {
    const [release] = sanitizeDemoReleases([{
      id: 'release-id',
      sequence: 24,
      status: 'active',
      reason: 'Published Private Manual',
      created_by: 'pipeline-worker',
      created_at: '2026-07-19T12:00:00.000Z',
      active: true,
      revision_count: 60_000,
      release_mode: 'delta',
      changed_records: 50,
      parent_release_id: 'parent-release-id'
    }])
    const [source] = sanitizeDemoSources([{
      id: 'source-id',
      title: 'Private Manual',
      document_type: 'manual',
      document_version: '1',
      document_date: null,
      status: 'completed',
      content_hash: 'sha256:private-document',
      failure_code: null,
      failure_message: 'Failed to parse Private Manual',
      discovered_at: '2026-07-19T12:00:00.000Z',
      updated_at: '2026-07-19T12:00:00.000Z',
      completed_at: '2026-07-19T12:00:00.000Z',
      vendor_slug: 'cisco',
      product_family: null,
      model: null,
      operating_system_slug: null,
      version_branch: null,
      document_role: 'commands',
      media_type: 'application/pdf',
      byte_size: 100,
      page_count: 1,
      artifact_status: 'converted',
      fragments_total: 1,
      fragments_completed: 1
    }])

    expect(release?.reason).toBe(REDACTED_SOURCE_IDENTITY)
    expect(source?.title).toBe(REDACTED_SOURCE_IDENTITY)
    expect(source?.content_hash).toBe(REDACTED_SOURCE_IDENTITY)
    expect(source?.failure_message).toBe(REDACTED_SOURCE_IDENTITY)
  })
})
