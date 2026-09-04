import type { CoverageTarget } from '@clideck/admin-contracts'
import { describe, expect, it } from 'vitest'

import { coverageChart } from './coverage'

function target(input: Partial<CoverageTarget>): CoverageTarget {
  return {
    id: crypto.randomUUID(),
    vendor_slug: 'cisco',
    product_family: null,
    model: null,
    operating_system_slug: 'ios-xe',
    version_branch: null,
    document_role: 'commands',
    status: 'covered',
    priority: 50,
    coverage_percent: 0,
    next_check_at: '2026-09-04T00:00:00.000Z',
    last_discovered_at: null,
    last_completed_at: null,
    source_count: 0,
    completed_sources: 0,
    failed_sources: 0,
    created_at: '2026-09-04T00:00:00.000Z',
    updated_at: '2026-09-04T00:00:00.000Z',
    ...input
  }
}

describe('coverage heatmap', () => {
  it('aggregates targets by vendor and operating system', () => {
    const option = coverageChart([
      target({ coverage_percent: 5, source_count: 10 }),
      target({ coverage_percent: 25, source_count: 20 }),
      target({
        vendor_slug: 'arista',
        operating_system_slug: 'eos',
        coverage_percent: 5,
        source_count: 4
      })
    ])

    expect(option.yAxis.data).toEqual([
      'arista · eos',
      'cisco · ios-xe'
    ])
    expect(option.series[0]!.data.map((entry) => entry.value)).toEqual([5, 15])
  })

  it('selects the largest groups instead of the twenty lowest rows', () => {
    const rows = Array.from({ length: 21 }, (_, index) => target({
      vendor_slug: `isolated-${index}`,
      operating_system_slug: 'unknown',
      coverage_percent: 0
    }))
    rows.push(...Array.from({ length: 3 }, () => target({
      vendor_slug: 'linux',
      operating_system_slug: 'debian',
      coverage_percent: 25,
      source_count: 10
    })))

    const option = coverageChart(rows)

    expect(option.yAxis.data).toContain('linux · debian')
    expect(option.series[0]!.data.some((entry) => entry.value === 25)).toBe(true)
  })
})
