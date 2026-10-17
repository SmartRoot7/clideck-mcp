import { expect, it } from 'vitest'
import { conformanceFixture } from '../domains/technical-operations/src/pack.js'
import { bindTechnicalCandidate, technicalQuestionKey, assertTechnicalReviewCoverage } from '../src/domain/technical-learning.js'
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
