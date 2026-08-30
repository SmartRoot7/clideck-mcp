import { describe, expect, it } from 'vitest'

import {
  batchEvidenceUnits,
  classifyFragmentDisposition,
  isUrlInsideCollectionScope,
  parseFieldLogSessions,
  sanitizeFieldLog,
  shouldRunQualityCheck
} from '../src/domain/pipeline-v2.js'

describe('Knowledge Pipeline 2.0', () => {
  it('excludes only unmistakable boilerplate and preserves operational material', () => {
    expect(classifyFragmentDisposition(
      'CONTENTS\nInterfaces........ 4\nRouting........ 18\nSecurity........ 44',
    )).toMatchObject({ reason: 'navigation_or_toc' })
    expect(classifyFragmentDisposition(
      'Use erase startup-config to remove the saved configuration.',
    )).toBeNull()
    expect(classifyFragmentDisposition(
      'ERROR: link down\nshow interface ethernet 1/1\nExpected output: up',
    )).toBeNull()
  })

  it('keeps evidence-window batches bounded and never mixes windows', () => {
    const batches = batchEvidenceUnits([
      { id: '1', estimatedTokens: 10_000, evidenceWindow: 'a' },
      { id: '2', estimatedTokens: 10_000, evidenceWindow: 'a' },
      { id: '3', estimatedTokens: 10_000, evidenceWindow: 'a' },
      { id: '4', estimatedTokens: 2_000, evidenceWindow: 'b' }
    ], { maximumRecords: 8, targetTokens: 24_000, hardTokens: 32_000 })
    expect(batches.map((batch) => batch.map((unit) => unit.id))).toEqual([
      ['1', '2'], ['3'], ['4']
    ])
  })

  it('uses full QA during calibration and deterministic sampling afterward', () => {
    expect(shouldRunQualityCheck({
      profileKey: 'p', sampleKey: 'first', checkedCount: 999,
      materialErrorCount: 0, forcedFullBatchesRemaining: 0
    })).toBe(true)
    expect(shouldRunQualityCheck({
      profileKey: 'p', sampleKey: 'forced', checkedCount: 10_000,
      materialErrorCount: 1, forcedFullBatchesRemaining: 20
    })).toBe(true)
    const decisions = Array.from({ length: 100 }, (_, index) =>
      shouldRunQualityCheck({
        profileKey: 'stable', sampleKey: String(index), checkedCount: 10_000,
        materialErrorCount: 10, forcedFullBatchesRemaining: 0
      }),
    )
    expect(decisions.filter(Boolean).length).toBeGreaterThan(2)
    expect(decisions.filter(Boolean).length).toBeLessThan(25)
  })

  it('sanitizes canary secrets and identifiers before parsing log sessions', () => {
    const raw = [
      'username=admin password=CanarySecret!23',
      'switch.example.com# show interface 10.10.4.8',
      '00:11:22:33:44:55',
      '---',
      'router# ping 192.0.2.1',
      '% Invalid input'
    ].join('\n')
    const result = sanitizeFieldLog(raw)
    expect(result.sanitized).not.toContain('CanarySecret!23')
    expect(result.sanitized).not.toContain('10.10.4.8')
    expect(result.sanitized).not.toContain('00:11:22:33:44:55')
    expect(result.sanitized).toContain('<SECRET>')
    expect(parseFieldLogSessions(result.sanitized)).toHaveLength(2)
  })

  it('enforces both host and path prefix for every crawl redirect', () => {
    const root = 'https://vendor.example/docs/network/'
    expect(isUrlInsideCollectionScope(
      'https://vendor.example/docs/network/cli/show.html', root, '/docs/network/',
    )).toBe(true)
    expect(isUrlInsideCollectionScope(
      'https://vendor.example/docs/storage/', root, '/docs/network/',
    )).toBe(false)
    expect(isUrlInsideCollectionScope(
      'https://evil.example/docs/network/', root, '/docs/network/',
    )).toBe(false)
  })
})
