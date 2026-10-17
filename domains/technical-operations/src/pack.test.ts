import { runDomainPackConformance } from '@clideck/domain-kit'
import { expect, it } from 'vitest'
import { conformanceFixture, domainPack } from './pack.js'
import { candidateSchema } from './schemas.js'
import { isTechnicalOperationsQuestion, technicalRequestContext } from './routing.js'

it('passes Domain Kit conformance', () => {
  expect(runDomainPackConformance(domainPack,conformanceFixture).passed).toBe(true)
})
it('keeps an OS version separate from a library version without a device catalogue', () => {
  expect(technicalRequestContext('Python huggingface_hub downloads on macOS',{
    operating_system:'macOS',version:'27.0.1',component_version:'1.32.0'
  })).toEqual({operating_system:'macos',operating_system_version:'27.0.1',component:'huggingface-hub',component_version:'1.32.0'})
  expect(technicalRequestContext('Inspect Node.js fetch errors',{operating_system:'Linux',version:'6.8'})).not.toHaveProperty('component_version')
})
it('requires source-backed core provenance without publishing the private request', () => {
  expect(conformanceFixture.candidate.payload).not.toHaveProperty('question')
  expect(candidateSchema.safeParse({...conformanceFixture.candidate,provenance:[]}).success).toBe(false)
})
it('routes explicit software diagnostics while preserving network hardware questions', () => {
  expect(isTechnicalOperationsQuestion('Inspect Node.js fetch failures',{operating_system:'Linux'})).toBe(true)
  expect(isTechnicalOperationsQuestion('Diagnose Python huggingface_hub downloads',{operating_system:'macOS'})).toBe(true)
  expect(isTechnicalOperationsQuestion('Inspect MACsec rekey on Linux',{operating_system:'Linux'})).toBe(false)
  expect(isTechnicalOperationsQuestion('Configure IOS XE BGP with Python',{operating_system:'IOS XE'},true)).toBe(false)
  expect(isTechnicalOperationsQuestion('Write a poem about a bird',{})).toBe(false)
})

it('retains risk and source scope in the core projection', () => {
  const core=domainPack.toCoreCandidate(conformanceFixture.candidate)
  expect(core.context).toEqual({component:'fixture-runtime',component_version:'1'})
  expect(core.provenance).toEqual(conformanceFixture.candidate.provenance)
  expect(core.risk_level).toBe('safe_read_only')
})

it('rejects an OS version copied into a different component context', () => {
  const candidate={...conformanceFixture.candidate,context:{component:'fixture-runtime',component_version:'27'}}
  expect(domainPack.validateCandidate(candidate)).toMatchObject({valid:false,issues:[expect.objectContaining({code:'UNDOCUMENTED_VERSION_CONTEXT'})]})
})

it('does not relabel a Darwin kernel version as a macOS product version', () => {
  expect(technicalRequestContext('Inspect Node.js on Darwin',{operating_system:'Darwin',version:'24.6.0'})).toMatchObject({operating_system:'darwin',operating_system_version:'24.6.0'})
})
