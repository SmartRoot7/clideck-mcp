import { describe, expect, it } from 'vitest'

import {
  assuranceFor,
  deriveVersionBranch,
  matchVersionApplicability,
  publicMatchLevel
} from '../src/domain/applicability.js'
import { classifyKnowledgeRisk } from '../src/domain/risk.js'

describe('knowledge applicability', () => {
  it('reuses an exact NX-OS revision only inside the same major.minor branch', () => {
    const branch = deriveVersionBranch('9.3.8', 'major_minor')
    expect(branch).toBe('9.3')
    expect(matchVersionApplicability({
      requested: '9.3.9',
      minimum: [9, 3, 8],
      maximum: [9, 3, 8],
      versionScope: 'exact',
      versionBranch: branch,
      versionStrategy: 'major_minor'
    })).toBe('same_branch_fallback')
    expect(matchVersionApplicability({
      requested: '10.1.1',
      minimum: [9, 3, 8],
      maximum: [9, 3, 8],
      versionScope: 'exact',
      versionBranch: branch,
      versionStrategy: 'major_minor'
    })).toBeNull()
  })

  it('orders exact, range, branch and unbounded matches explicitly', () => {
    expect(deriveVersionBranch('202311', 'calendar')).toBe('2023.11')
    expect(matchVersionApplicability({
      requested: '17.9.4',
      minimum: [17, 9, 4],
      maximum: [17, 9, 4],
      versionScope: 'exact',
      versionBranch: '17.9',
      versionStrategy: 'major_minor'
    })).toBe('exact')
    expect(matchVersionApplicability({
      requested: '17.9.4',
      minimum: [17, 9, 1],
      maximum: [17, 9, 9],
      versionScope: 'range',
      versionBranch: null,
      versionStrategy: 'major_minor'
    })).toBe('explicit_range')
    expect(matchVersionApplicability({
      requested: '17.9.4',
      minimum: null,
      maximum: null,
      versionScope: 'branch',
      versionBranch: '17.9',
      versionStrategy: 'major_minor'
    })).toBe('branch')
    expect(matchVersionApplicability({
      requested: '17.9.4',
      minimum: null,
      maximum: null,
      versionScope: 'unbounded',
      versionBranch: null,
      versionStrategy: 'major_minor'
    })).toBe('unbounded')
  })

  it('marks portable and same-branch answers with honest assurance', () => {
    expect(publicMatchLevel('os_family')).toBe('os_family')
    expect(assuranceFor('os_family', 'unbounded')).toBe('generic')
    expect(assuranceFor('model', 'same_branch_fallback')).toBe('best_effort')
    expect(assuranceFor('model', 'exact')).toBe('exact')
  })

  it('does not misclassify portable inspection commands as dangerous', () => {
    expect(classifyKnowledgeRisk(['onie-sysinfo'])).toBe('safe_read_only')
    expect(classifyKnowledgeRisk(['nv show interface status'])).toBe(
      'safe_read_only'
    )
    expect(classifyKnowledgeRisk(['ip link show'])).toBe('safe_read_only')
    expect(classifyKnowledgeRisk(['ip link set eth0 down'])).toBe('unknown')
    expect(classifyKnowledgeRisk(['networkctl reload'])).toBe(
      'service_disruptive'
    )
    expect(classifyKnowledgeRisk(['onie-sysinfo-danger'])).toBe('unknown')
    expect(classifyKnowledgeRisk(['onie-self-update image.bin'])).toBe('unknown')
  })
})
