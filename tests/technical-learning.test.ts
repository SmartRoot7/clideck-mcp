import { expect, it } from 'vitest'
import { technicalArtifactRejection } from '../src/mcp/result.js'
import { isRetryableCodexPlatformArtifactFailure } from '../src/domain/pipeline.js'
import { openAiStrictJsonSchema } from '../src/domain/structured-output.js'
import { conformanceFixture } from '../domains/technical-operations/src/pack.js'
import { bindTechnicalCandidate, technicalQuestionKey, assertTechnicalReviewCoverage, technicalArtifactSchema } from '../src/domain/technical-learning.js'
import type { TechnicalEvidence } from '../src/domain/technical-learning.js'
import type { TechnicalAnswerReview } from '@clideck/domain-technical-operations'

const evidence:TechnicalEvidence={
  id:'11111111-1111-4111-8111-111111111111',source_id:'22222222-2222-4222-8222-222222222222',
  canonical_url:conformanceFixture.candidate.provenance[0]!.url,source_ref:'fixture:official',source_kind:'official_web',
  document_type:'project_fixture',title:'Trusted fixture title',document_version:null,document_date:null,section_title:null,
  content:'Read the controlled fixture.',content_hash:`sha256:${'c'.repeat(64)}`
}
const key=`sha256:${'d'.repeat(64)}`
const review:TechnicalAnswerReview={question_key:key,approved:true,answer_status:'complete',covered_capabilities:['inspect-fixture'],candidate:null,missing_capabilities:[],missing_context:[],next_searches:[],reason:'All requested fixture evidence is supported.'}

it('binds public provenance to leased source bytes and removes duplicate identities', () => {
  const candidate={...conformanceFixture.candidate,provenance:[...conformanceFixture.candidate.provenance,...conformanceFixture.candidate.provenance]}
  const bound=bindTechnicalCandidate(candidate,[evidence],'technical-operations.answer.fixture','2026-10-17')
  expect(bound.provenance).toHaveLength(1)
  expect(bound.provenance[0]).toMatchObject({title:'Trusted fixture title',source_ref:'fixture:official',content_hash:evidence.content_hash})
  expect(bound.stable_key).toBe('technical-operations.answer.fixture')
  expect(()=>bindTechnicalCandidate({...candidate,provenance:[{...candidate.provenance[0],content_hash:`sha256:${'0'.repeat(64)}`}]},[evidence],bound.stable_key,'2026-10-17')).toThrow('TECHNICAL_PROVENANCE_NOT_IN_TASK')
  expect(()=>bindTechnicalCandidate({...candidate,provenance:[{...candidate.provenance[0],evidence_fragment:'Invented unsupported claim.'}]},[evidence],bound.stable_key,'2026-10-17')).toThrow('TECHNICAL_PROVENANCE_NOT_IN_TASK')
})
it('requires every original capability and matching software component before complete closure', () => {
  expect(()=>assertTechnicalReviewCoverage(review,{questionKey:key,requiredCapabilities:['inspect-fixture','missing-step'],requestedContext:{}},conformanceFixture.candidate)).toThrow('TECHNICAL_REVIEW_INCOMPLETE')
  expect(()=>assertTechnicalReviewCoverage(review,{questionKey:key,requiredCapabilities:['inspect-fixture'],requestedContext:{component:'python'}},conformanceFixture.candidate)).toThrow('TECHNICAL_REVIEW_COMPONENT_MISMATCH')
  expect(()=>assertTechnicalReviewCoverage(review,{questionKey:key,requiredCapabilities:['inspect-fixture'],requestedContext:{component:'fixture-runtime',component_version:'27'}},conformanceFixture.candidate)).toThrow('TECHNICAL_REVIEW_COMPONENT_VERSION_MISMATCH')
  expect(()=>assertTechnicalReviewCoverage(review,{questionKey:key,requiredCapabilities:['inspect-fixture'],requestedContext:{component:'fixture-runtime',component_version:'1'}},conformanceFixture.candidate)).not.toThrow()
})
it('does not reuse a reviewed answer for case-sensitive code or a different version namespace', () => {
  expect(technicalQuestionKey('Inspect Foo()',{})).not.toBe(technicalQuestionKey('Inspect foo()',{}))
  expect(technicalQuestionKey('Inspect runtime',{operating_system_version:'27'})).not.toBe(technicalQuestionKey('Inspect runtime',{component_version:'27'}))
})

it('binds task identifiers and verification dates using provider-supported constants and enums',()=>{
 const schema=technicalArtifactSchema(false,{question_key:key,required_capabilities:['inspect-fixture']},'2026-10-17')
 const output=openAiStrictJsonSchema(schema) as any
 expect(output.properties.question_key.const).toBe(key)
 expect(output.properties.covered_capabilities.items.enum ?? [output.properties.covered_capabilities.items.const]).toEqual(['inspect-fixture'])
 expect(output.properties.missing_capabilities.items.enum ?? [output.properties.missing_capabilities.items.const]).toEqual(['inspect-fixture'])
 const candidate=output.properties.candidate.anyOf.find((value:any)=>value.type==='object')
 expect(candidate.properties.last_verified_at.const).toBe('2026-10-17')
 expect(candidate.properties.provenance.items.properties.verified_at.const).toBe('2026-10-17')
 const draft={...review,candidate:conformanceFixture.candidate};delete (draft as Partial<TechnicalAnswerReview>).approved
 expect(()=>schema.parse(draft)).not.toThrow()
 expect(()=>schema.parse({...draft,question_key:`sha256:${'e'.repeat(64)}`})).toThrow()
 expect(()=>schema.parse({...draft,covered_capabilities:['A long natural-language restatement '.repeat(5)]})).toThrow()
 expect(()=>schema.parse({...draft,candidate:{...conformanceFixture.candidate,last_verified_at:'October 17, 2026'}})).toThrow()
})
it('keeps source hashes and quote checks independent of generated metadata bindings',()=>{
 const schema=technicalArtifactSchema(true,{question_key:key,required_capabilities:['inspect-fixture']},'2026-10-17')
 const artifact=schema.parse({...review,candidate:{...conformanceFixture.candidate,provenance:[{...conformanceFixture.candidate.provenance[0],content_hash:`sha256:${'0'.repeat(64)}`}]}})
 expect(()=>bindTechnicalCandidate(artifact.candidate,[evidence],'technical-operations.answer.fixture','2026-10-17')).toThrow('TECHNICAL_PROVENANCE_NOT_IN_TASK')
})

it('reports technical citation rejection as finite artifact feedback without leaking error details',()=>{
 const result=technicalArtifactRejection(new Error('TECHNICAL_PROVENANCE_NOT_IN_TASK: private case detail'))
 expect(result?.isError).toBe(true)
 expect(result?.content[0]?.text).toContain('exact contiguous source quote')
 expect(JSON.stringify(result)).not.toContain('private case detail')
 expect(isRetryableCodexPlatformArtifactFailure(result!.content[0]!.text)).toBe(false)
 expect(technicalArtifactRejection(new Error('unexpected storage failure'))).toBeNull()
})
