import { describe, expect, it } from 'vitest'

import {
  classifyMcpOutcome,
  extractMcpQuestion,
  sanitizeMcpLogPayload
} from '../src/domain/mcp-observability.js'

describe('MCP observability privacy boundary', () => {
  it('redacts secrets, source identity, and sensitive snapshot values', () => {
    const result = sanitizeMcpLogPayload({
      question: 'How do I check an interface?',
      access_token: 'task-secret',
      source_url: 'https://internal.example/manual',
      snapshot: [
        'hostname edge-private',
        'username admin password SuperSecret123',
        'interface Gi1/0/1'
      ].join('\n')
    })
    const serialized = JSON.stringify(result)

    expect(serialized).not.toContain('task-secret')
    expect(serialized).not.toContain('internal.example')
    expect(serialized).not.toContain('SuperSecret123')
    expect(serialized).toContain('XXXXXXXX')
  })

  it('classifies unknown, blocked, and answered results consistently', () => {
    expect(classifyMcpOutcome({ unknown: true })).toBe('unknown')
    expect(classifyMcpOutcome({ status: 'unknown' })).toBe('unknown')
    expect(classifyMcpOutcome({ decision: 'blocked' })).toBe('blocked')
    expect(classifyMcpOutcome({ answers: [{ title: 'Answer' }] })).toBe(
      'success',
    )
  })

  it('extracts the human question without retaining unbounded input', () => {
    expect(extractMcpQuestion('query_network_knowledge', {
      question: `  ${'x'.repeat(2_000)}  `
    })).toHaveLength(1_000)
  })
})
