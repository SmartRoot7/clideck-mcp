import { z } from 'zod'
import {
  candidateSchema as technicalCandidateSchema,
  domainPack as technicalDomainPack,
  answerDraftSchema,
  answerReviewSchema,
  technicalRequestContext,
  type PackCandidate,
  type PackContext,
  type TechnicalAnswerReview,
} from '@clideck/domain-technical-operations'
import { sanitizeSnapshot } from './snapshot.js'
import { sha256Label } from '../crypto.js'
import { escalateKnowledgeRisk, type KnowledgeRiskLevel } from './risk.js'

export const technicalDomainId = 'technical-operations'
export const technicalEvidenceSchema = z.strictObject({
  id:z.string().uuid(), source_id:z.string().uuid(),
  canonical_url:z.url().startsWith('https://'),
  source_ref:z.string().nullable(), source_kind:z.literal('official_web'),
  document_type:z.string(), title:z.string(), document_version:z.string().nullable(),
  document_date:z.string().nullable(), section_title:z.string().nullable(),
  content:z.string(), content_hash:z.string().regex(/^sha256:[0-9a-f]{64}$/)
})
export type TechnicalEvidence = z.infer<typeof technicalEvidenceSchema>

/** Use the same retained question as learning intake; never hash raw secrets
 * into a different completion binding from their deliberately redacted form. */
export function retainedTechnicalQuestion(question:string):string {
  return sanitizeSnapshot(question.replaceAll('\u0000',''),'strict').sanitized.slice(0,2000)
}
export function technicalQuestionKey(question:string, context:PackContext):string {
  const scope=Object.fromEntries(Object.entries(context).filter(([,value])=>value!==undefined).sort(([left],[right])=>left.localeCompare(right)))
  return sha256Label(JSON.stringify([retainedTechnicalQuestion(question).trim(),scope]))
}

function object(value:unknown):Record<string,unknown> {
  return value && typeof value==='object' && !Array.isArray(value) ? value as Record<string,unknown> : {}
}
function omitNulls(value:unknown):unknown {
  if (Array.isArray(value)) return value.map(omitNulls)
  if (value && typeof value==='object') return Object.fromEntries(Object.entries(value).filter(([,entry])=>entry!==null).map(([key,entry])=>[key,omitNulls(entry)]))
  return value
}
export function parseTechnicalDraft(value:unknown) {
  const input=object(value)
  return answerDraftSchema.parse({...input,candidate:input['candidate']===null ? null : omitNulls(input['candidate'])})
}
export function parseTechnicalReview(value:unknown) {
  const input=object(value)
  return answerReviewSchema.parse({...input,candidate:input['candidate']===null ? null : omitNulls(input['candidate'])})
}

function enforceTechnicalRisk(candidate:PackCandidate):PackCandidate {
  if (candidate.risk_level==='physical_harm') return {...candidate,dangerous:true}
  const declared:KnowledgeRiskLevel=candidate.risk_level==='changes_state' ? 'changes_config' : candidate.risk_level
  const assessed=escalateKnowledgeRisk(declared,[...(candidate.payload.command ? [candidate.payload.command] : []),...candidate.payload.procedure])
  const mapped={safe_read_only:'safe_read_only',changes_config:'changes_state',credential_sensitive:'credential_sensitive',service_disruptive:'service_disruptive',data_loss:'data_loss',storage_wipe:'data_loss',firmware_change:'service_disruptive',boot_change:'service_disruptive',factory_reset:'data_loss',unknown:'unknown'} as const
  const risk=mapped[assessed]
  const dangerous=candidate.dangerous || risk!=='safe_read_only'
  return {...candidate,risk_level:risk,dangerous,
    risks:risk!==candidate.risk_level || dangerous!==candidate.dangerous
      ? [...candidate.risks,`Deterministic safety classifier enforced risk level ${risk}.`].slice(0,30) : candidate.risks}
}

/** Only server-persisted task evidence supplies source identity and hashes. */
export function bindTechnicalCandidate(
  value:unknown,
  evidence:TechnicalEvidence[],
  stableKey:string,
  verifiedAt:string,
):PackCandidate {
  const candidate=technicalCandidateSchema.parse(value)
  const unique=new Map<string,PackCandidate['provenance'][number]>()
  const normalize=(text:string)=>text.replace(/\s+/g,' ').trim()
  for (const provenance of candidate.provenance) {
    const source=evidence.find(fragment=>fragment.canonical_url===provenance.url && fragment.content_hash===provenance.content_hash && normalize(fragment.content).includes(normalize(provenance.evidence_fragment)))
    if (!source || !normalize(provenance.evidence_fragment)) throw new Error('TECHNICAL_PROVENANCE_NOT_IN_TASK')
    const bound={
      url:source.canonical_url,source_kind:'official_web' as const,
      ...(source.source_ref ? {source_ref:source.source_ref} : {}),
      document_type:source.document_type,title:source.title.slice(0,240),
      ...(source.document_version ? {document_version:source.document_version.slice(0,120)} : {}),
      ...(source.document_date ? {document_date:source.document_date} : {}),
      verified_at:verifiedAt,content_hash:source.content_hash,
      evidence_fragment:provenance.evidence_fragment,evidence_role:provenance.evidence_role
    }
    const key=`${bound.url}\n${bound.content_hash}`
    const prior=unique.get(key)
    if (!prior || bound.evidence_role==='primary' || prior.evidence_role==='conflict') unique.set(key,bound)
  }
  const bound=enforceTechnicalRisk(technicalCandidateSchema.parse({...candidate,stable_key:stableKey,last_verified_at:verifiedAt,provenance:[...unique.values()],context:technicalDomainPack.normalizeContext(candidate.context)}))
  const validation=technicalDomainPack.validateCandidate(bound)
  if (!validation.valid) throw new Error(`TECHNICAL_CANDIDATE_INVALID:${validation.issues.map(issue=>issue.code).join(',')}`)
  return bound
}

export function assertTechnicalReviewCoverage(
  review:TechnicalAnswerReview,
  input:{questionKey:string;requiredCapabilities:string[];requestedContext:PackContext},
  candidate:PackCandidate | null,
):void {
  if (review.question_key!==input.questionKey) throw new Error('TECHNICAL_QUESTION_KEY_MISMATCH')
  if (!review.approved) return
  if (!candidate || review.answer_status==='unknown') throw new Error('TECHNICAL_REVIEW_WITHOUT_SUPPORTED_ANSWER')
  if (review.answer_status!=='complete') return
  if (review.missing_capabilities.length || review.missing_context.length || input.requiredCapabilities.some(capability=>!review.covered_capabilities.includes(capability))) {
    throw new Error('TECHNICAL_REVIEW_INCOMPLETE')
  }
  const requested=input.requestedContext
  if (requested.component && !candidate.payload.documented_components.some(component=>technicalRequestContext('',{component:component.name}).component===requested.component)) throw new Error('TECHNICAL_REVIEW_COMPONENT_MISMATCH')
  const documented=technicalDomainPack.normalizeContext(candidate.context)
  if (requested.operating_system && documented.operating_system && requested.operating_system!==documented.operating_system) throw new Error('TECHNICAL_REVIEW_OS_MISMATCH')
  if (requested.operating_system_version && documented.operating_system_version && requested.operating_system_version!==documented.operating_system_version) throw new Error('TECHNICAL_REVIEW_OS_VERSION_MISMATCH')
  if (requested.component_version) {
    const supported=candidate.payload.documented_components.some(component=>{
      const normalized=technicalRequestContext('',{component:component.name})
      return normalized.component===requested.component && component.version===requested.component_version
    })
    if (!supported) throw new Error('TECHNICAL_REVIEW_COMPONENT_VERSION_MISMATCH')
  }
}
