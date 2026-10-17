import { z } from 'zod'
import { technicalRequestContext, publicRecordSchema, type PackPublicRecord } from '@clideck/domain-technical-operations'
import type { Database, DatabaseClient } from '../db.js'
import { sha256Label } from '../crypto.js'
import { searchDomainKnowledge, createDomainKnowledgeRevision } from './domain-knowledge.js'
import { publishKnowledgeBatch } from './publication.js'
import { technicalDomainId, retainedTechnicalQuestion, technicalQuestionKey, technicalEvidenceSchema, parseTechnicalDraft, parseTechnicalReview, bindTechnicalCandidate, assertTechnicalReviewCoverage } from './technical-learning.js'
import type { PipelineTaskRow } from './pipeline.js'
import type { PublicKnowledge } from './schemas.js'
import { buildSearchQueries } from './search-query.js'

const policyVersion = 'technical-answer-v2'
type Client = Pick<DatabaseClient, 'query'>
type Enqueue = (client: DatabaseClient, input: {
  type: PipelineTaskRow['task_type']; stage: PipelineTaskRow['stage']; priority: number;
  dedupeKey: string; knowledgeDemandId: string; payload: Record<string, unknown>;
  reasoningEffort?: 'low' | 'medium'; queueClass: 'demand'
}) => Promise<string | null>
export const technicalRequestScope = (question: string, context: Record<string, unknown>) => {
  const raw=(context['raw_context'] as Record<string, unknown> | undefined) ?? context
  const value=(key:string)=>typeof raw[key]==='string' && raw[key].trim() ? z.string().trim().min(1).max(240).parse(raw[key]) : undefined
  const vendor=value('vendor')
  // Retain legacy request constraints privately even when the public component
  // pack has no hardware/mode applicability dimension. They cannot share an
  // exact completion cache, and the reviewer must see the requested environment.
  return {...technicalRequestContext(retainedTechnicalQuestion(question),raw),
    runtime_mode:value('runtime_mode') ?? 'normal',
    ...(vendor && !/^not[ -]specified$/i.test(vendor) ? {vendor:vendor.toLowerCase()} : {}),
    ...(value('model') ? {model:value('model')!} : {}),
    ...(value('architecture') ? {architecture:value('architecture')!} : {}),
    ...(value('execution_environment') ? {execution_environment:value('execution_environment')!} : {})}
}
export const technicalFeedbackHash = (context: Record<string, unknown>) => sha256Label(JSON.stringify([
  context['feedback_reason'] ?? null, context['reported_revision_refs'] ?? []
]))
const snapshotSchema = z.object({
  answer_id: z.string().uuid(), question_key: z.string(), feedback_hash: z.string(),
  question: z.string(), requested_context: z.record(z.string(), z.unknown()),
  required_capabilities: z.array(z.string()), stable_key: z.string(),
  evidence: z.array(technicalEvidenceSchema), previous_answer: z.unknown().optional(),
  diagnosis: z.unknown().optional(), feedback: z.unknown().optional(),
})


/** Read-only exact replay: a keyword-related fact alone cannot close a question. */
export async function lookupTechnicalAnswer(client: Client, question: string, rawContext: Record<string, unknown>, limit = 5) {
  const context = technicalRequestScope(question, rawContext)
  const key = technicalQuestionKey(question, context)
  const reviewed = await client.query<{ revision_id: string; answer_status: 'complete' | 'partial'; covered_capabilities: string[] }>(
    `SELECT answer.revision_id, answer.answer_status, answer.covered_capabilities
       FROM technical_demand_answers answer
       JOIN knowledge_demands demand ON demand.id = answer.demand_id
       JOIN active_knowledge_state active ON active.revision_id = answer.revision_id
      WHERE answer.question_key = $1 AND answer.status = 'published'
        AND answer.feedback_hash = coalesce(demand.context->>'technical_feedback_hash',$2)
        AND NOT (coalesce(demand.context->'reported_revision_refs','[]') ?
          (SELECT public_ref::text FROM knowledge_revisions WHERE id=answer.revision_id))
      ORDER BY answer.updated_at DESC LIMIT 1`,
    [key, technicalFeedbackHash(rawContext)],
  )
  const exact = reviewed.rows[0]
  const found = await searchDomainKnowledge(client, { domainId: technicalDomainId, question,
    context: exact ? {} : technicalRequestContext('',context), limit,
    ...(exact ? { revisionIds: [exact.revision_id] } : {}) })
  const related = found.records.map(record => publicRecordSchema.parse(record))
  const incompatible=(record:PackPublicRecord)=>Boolean(
    context.operating_system && record.context.operating_system && context.operating_system!==record.context.operating_system ||
    context.operating_system_version && record.context.operating_system_version && context.operating_system_version!==record.context.operating_system_version ||
    context.component_version && record.context.component_version && context.component_version!==record.context.component_version)
  const records=related.filter(record=>!incompatible(record))
  const crossPlatformRecords=related.filter(incompatible)
  return { domain_id: technicalDomainId, context, records, crossPlatformRecords,
    unknown: !exact && records.length === 0,
    answer_status: exact && records.length ? exact.answer_status : records.length ? 'partial' as const : 'unknown' as const,
    coverage: (exact?.covered_capabilities ?? []).map(capability => ({ capability, label: capability, status: 'covered' as const, answer_refs: records.map(record => record.revision_ref) })),
    next_action: records.length ? 'use_answer' as const : 'knowledge_not_found' as const }
}

export function technicalLegacyAnswer(record: PackPublicRecord): PublicKnowledge {
  return {
    revision_ref: record.revision_ref, kind: record.record_type as PublicKnowledge['kind'],
    title: record.title, summary: record.payload.answer,
    applicability: { vendor: 'Not specified', model: null,
      operating_system: record.context.operating_system ?? 'Component documentation',
      versions: { minimum: record.context.operating_system_version ?? null, maximum: record.context.operating_system_version ?? null, requested: null },
      context_relation: 'portable', version_match: 'unbounded', documented_version_relation: 'unspecified',
      assurance_level: 'generic', requires_platform_confirmation: true },
    cli_mode: record.context.shell_environment ?? null, command: record.payload.command ?? null,
    procedure: record.payload.procedure, prerequisites: record.prerequisites,
    risks: record.risks, verification: record.verification, rollback: record.rollback,
    last_verified_at: record.last_verified_at, confidence: record.confidence, quality_score: record.quality_score,
    dangerous: record.dangerous, assurance: { validation_level: 'documentation_reviewed',
      independent_confirmations: record.assurance.independent_confirmations,
      confidence_explanation: record.confidence_reason, next_review_at: record.assurance.next_review_at, lab_validated_at: null },
    conflicts: record.conflicts, limitations: [...record.limitations,
      ...record.payload.documented_components.map(component => `${component.name}${component.version ? ` ${component.version}` : ''}: ${component.applicability}`)]
  }
}

/** At most the operator capacity is queued; ordinary task leases enforce lanes. */
export async function queueTechnicalAnswer(client: DatabaseClient, enqueue: Enqueue): Promise<boolean> {
  const selected = await client.query<{
    id: string; question: string; context: Record<string, unknown>; technical_answer_key: string;
    diagnosis: { subquestions?: Array<{ capability: string }>; missing_capabilities?: string[] };
  }>(`SELECT demand.id, demand.question, demand.context, demand.technical_answer_key,
          jsonb_build_object('subquestions', diagnostic.subquestions,
            'missing_capabilities', diagnostic.missing_capabilities,
            'search_expansions', diagnostic.search_expansions) AS diagnosis
       FROM knowledge_demands demand
       JOIN LATERAL (SELECT * FROM knowledge_demand_diagnostics
         WHERE knowledge_demand_id=demand.id AND status='completed'
         ORDER BY created_at DESC LIMIT 1) diagnostic ON true
      WHERE demand.domain_id='technical-operations' AND demand.status<>'published'
        AND (demand.source_candidate_id IS NOT NULL
          OR EXISTS(SELECT 1 FROM source_candidates source WHERE source.knowledge_demand_id=demand.id AND source.source_kind='official_web')
          OR EXISTS(SELECT 1 FROM knowledge_demand_source_attempts attempt WHERE attempt.knowledge_demand_id=demand.id)
          OR EXISTS(SELECT 1 FROM pipeline_tasks searched WHERE searched.knowledge_demand_id=demand.id
            AND searched.task_type='source_discovery' AND searched.status='completed'
            AND jsonb_array_length(coalesce(searched.result->'searched_source_urls','[]'))>0))
        AND demand.diagnosis_status='completed' AND demand.last_error_code IS DISTINCT FROM 'CONTEXT_REQUIRED'
        AND NOT EXISTS (SELECT 1 FROM pipeline_tasks task WHERE task.knowledge_demand_id=demand.id
          AND task.task_type IN ('technical_answer','technical_answer_review','technical_answer_publication')
          AND task.status IN ('queued','claimed','running'))
      ORDER BY demand.priority DESC, demand.first_seen_at
      FOR UPDATE OF demand SKIP LOCKED`)
  for (const demand of selected.rows) {
    const context = technicalRequestScope(demand.question, demand.context)
    const questionKey = technicalQuestionKey(demand.question, context)
    const feedbackHash = technicalFeedbackHash(demand.context)
    const prior = await client.query<{ candidate: unknown; payload: Record<string, unknown> }>(
      `SELECT answer.candidate, task.payload FROM technical_demand_answers answer
       JOIN pipeline_tasks task ON task.id=answer.draft_task_id
       WHERE answer.demand_id=$1 AND answer.question_key=$2 AND answer.feedback_hash=$3
         AND answer.candidate IS NOT NULL AND answer.status IN ('published','unresolved')
       ORDER BY answer.created_at DESC LIMIT 1`, [demand.id,questionKey,feedbackHash])
    const previous = prior.rows[0]
    const previousCandidate = previous?.candidate as { provenance?: Array<{ content_hash: string; url: string; evidence_fragment:string }> } | undefined
    const retained = z.array(technicalEvidenceSchema).parse(previous?.payload['evidence'] ?? [])
      .filter(evidence => previousCandidate?.provenance?.some(source => source.content_hash===evidence.content_hash && source.url===evidence.canonical_url && evidence.content.replace(/\s+/g,' ').includes(source.evidence_fragment.replace(/\s+/g,' ')))).slice(0,10)
    // Sources may be reused as immutable evidence without stealing reservations or ownership.
    // Old oversized fragments are visited in bounded spans; parent provenance hash is retained.
    const found = await client.query<Record<string, unknown>>(`WITH linked_sources AS (
        SELECT id FROM source_candidates WHERE knowledge_demand_id=$1
        UNION SELECT source_candidate_id FROM knowledge_demand_source_attempts WHERE knowledge_demand_id=$1
        UNION SELECT source_candidate_id FROM knowledge_demands WHERE id=$1 AND source_candidate_id IS NOT NULL
        UNION SELECT source.id FROM source_candidates source JOIN (
          SELECT jsonb_array_elements_text(coalesce(result->'searched_source_urls','[]')) AS url
          FROM (SELECT result FROM pipeline_tasks WHERE knowledge_demand_id=$1
            AND task_type='source_discovery' AND status='completed' ORDER BY completed_at DESC LIMIT 10) history
        ) urls ON source.canonical_url=urls.url
      ), used AS MATERIALIZED (
        SELECT ref->>'id' AS id, coalesce((ref->>'offset')::int,0) AS span_offset, ref->>'content_hash' AS content_hash
        FROM technical_demand_answers answer CROSS JOIN LATERAL jsonb_array_elements(answer.evidence_refs) ref
        WHERE answer.demand_id=$1 AND answer.question_key=$2 AND answer.feedback_hash=$3 AND answer.policy_version=$4
      ), ranked AS (
        SELECT fragment.id, source.id source_id, source.canonical_url, source.source_ref,
          source.source_kind, source.document_type, source.title, source.document_version,
          source.document_date::text, fragment.section_title, fragment.content_hash,
          span.span_offset, substring(fragment.content FROM span.span_offset+1 FOR widths.span_chars) content,
          relevance.matches AS term_matches,
          row_number() OVER (PARTITION BY source.id ORDER BY
            relevance.matches DESC, fragment.ordinal, span.span_offset) doc_rank
        FROM linked_sources linked JOIN source_candidates source ON source.id=linked.id
        JOIN source_artifacts artifact ON artifact.source_candidate_id=source.id
        JOIN source_fragments fragment ON fragment.source_artifact_id=artifact.id
        CROSS JOIN LATERAL (SELECT CASE
          WHEN octet_length(fragment.content)<=4096 OR octet_length(fragment.content)=char_length(fragment.content) THEN 4096
          ELSE 1024 END AS span_chars) widths
        CROSS JOIN LATERAL generate_series(0,greatest(0,char_length(fragment.content)-1),widths.span_chars) span(span_offset)
        CROSS JOIN LATERAL (SELECT count(*)::int matches FROM unnest($5::text[]) term
          WHERE fragment.content ILIKE '%' || term || '%') relevance
        WHERE source.source_kind='official_web' AND source.canonical_url LIKE 'https://%'
          AND NOT EXISTS (SELECT 1 FROM used WHERE used.id=fragment.id::text AND used.span_offset=span.span_offset AND used.content_hash=fragment.content_hash)
      ) SELECT * FROM ranked ORDER BY doc_rank, term_matches DESC, source_id, id, span_offset LIMIT 16`,
      [demand.id,questionKey,feedbackHash,policyVersion,buildSearchQueries(demand.question).tokens.slice(0,24)])
    if (!found.rows.length) continue
    const evidence = [...retained]
    const refs: Array<Record<string, unknown>> = []
    let bytes = evidence.reduce((sum,item)=>sum+Buffer.byteLength(item.content),0)
    for (const row of found.rows) {
      const { span_offset: offset, doc_rank: _rank, term_matches: _matches, ...raw } = row
      const fragment = technicalEvidenceSchema.parse(raw)
      const size = Buffer.byteLength(fragment.content)
      if (evidence.length>=16 || bytes+size>65536) break
      evidence.push(fragment); bytes+=size
      refs.push({ id:fragment.id,offset,content_hash:fragment.content_hash })
    }
    if (!refs.length) continue
    const evidenceHash = sha256Label(JSON.stringify([questionKey, feedbackHash, policyVersion, refs, retained.map(item=>item.content_hash)]))
    const required = [...new Set([...(demand.diagnosis.subquestions ?? []).map(part=>part.capability),...(demand.diagnosis.missing_capabilities ?? [])])]
    const inserted = await client.query<{id:string}>(`INSERT INTO technical_demand_answers
      (demand_id,question_key,feedback_hash,requested_context,evidence_hash,evidence_refs,policy_version,required_capabilities)
      VALUES ($1,$2,$3,$4::jsonb,$5,$6::jsonb,$7,$8) ON CONFLICT (demand_id,evidence_hash) DO NOTHING RETURNING id`,
      [demand.id,questionKey,feedbackHash,JSON.stringify(context),evidenceHash,JSON.stringify(refs),policyVersion,required])
    const answerId = inserted.rows[0]?.id
    if (!answerId) continue
    const taskId = await enqueue(client, { type:'technical_answer',stage:'analyze',priority:165,
      knowledgeDemandId:demand.id,queueClass:'demand',dedupeKey:`technical:${answerId}:draft`,
      payload:{ answer_id:answerId,question_key:questionKey,feedback_hash:feedbackHash,
        question:demand.question,requested_context:context,required_capabilities:required,
        stable_key:`technical-operations.answer.${demand.technical_answer_key}`,evidence,
        diagnosis:demand.diagnosis,previous_answer:previous?.candidate ?? null,
        feedback:demand.context['feedback_reason'] ?? null } })
    await client.query('UPDATE technical_demand_answers SET draft_task_id=$2 WHERE id=$1',[answerId,taskId])
    await client.query("UPDATE knowledge_demands SET status='processing',last_error_code=NULL, context=jsonb_set(context,'{technical_feedback_hash}',to_jsonb($2::text)) WHERE id=$1",[demand.id,feedbackHash])
    return true
  }
  return false
}

async function currentSnapshot(client: Client, task: PipelineTaskRow) {
  const snapshot = snapshotSchema.parse(task.payload)
  const result = await client.query<{ question:string;context:Record<string,unknown> }>(
    'SELECT question,context FROM knowledge_demands WHERE id=$1 FOR UPDATE', [task.knowledge_demand_id])
  const demand = result.rows[0]
  const current = demand && technicalQuestionKey(demand.question,technicalRequestScope(demand.question,demand.context))===snapshot.question_key
    && technicalFeedbackHash(demand.context)===snapshot.feedback_hash
  if (!current) await client.query("UPDATE technical_demand_answers SET status='superseded',updated_at=now() WHERE id=$1",[snapshot.answer_id])
  return { snapshot, current }
}

function assertNoPrivateEcho(candidate: unknown, question: string, evidence:Array<{content:string}>) {
  const serialized=JSON.stringify(candidate)
  const tokens=[question,...question.matchAll(/(?:\/Users\/|\/home\/|\/opt\/)[^\s"']+|\b(?:\d{1,3}\.){3}\d{1,3}\b/g)].map(value=>typeof value==='string' ? value : value[0])
  const publicLiteral=(value:string)=>evidence.some(fragment=>fragment.content.replace(/\s+/g,' ').includes(value.replace(/\s+/g,' ')))
  if (tokens.some(value=>value.length>=7 && serialized.includes(value) && !publicLiteral(value))) throw new Error('TECHNICAL_PRIVATE_CONTEXT_IN_PUBLIC_ANSWER')
}

export async function submitTechnicalArtifact(client: DatabaseClient, task: PipelineTaskRow, artifact: unknown, enqueue: Enqueue): Promise<Record<string, unknown>> {
  const {snapshot,current}=await currentSnapshot(client,task)
  if (!current) return { superseded:true }
  const review=task.task_type==='technical_answer_review'
  const parsed=review ? parseTechnicalReview(artifact) : parseTechnicalDraft(artifact)
  if (parsed.question_key!==snapshot.question_key) throw new Error('TECHNICAL_QUESTION_KEY_MISMATCH')
  const candidate=parsed.candidate ? bindTechnicalCandidate(parsed.candidate,snapshot.evidence,`${snapshot.stable_key}.${parsed.candidate.record_type}`,new Date().toISOString().slice(0,10)) : null
  if (candidate) assertNoPrivateEcho(candidate,snapshot.question,snapshot.evidence)
  if (review) assertTechnicalReviewCoverage(parseTechnicalReview({...parsed,candidate}), {
    questionKey:snapshot.question_key,requestedContext:technicalRequestContext('',snapshot.requested_context),requiredCapabilities:snapshot.required_capabilities },candidate)
  const approved=review && parseTechnicalReview(parsed).approved
  const state=review ? approved ? 'publication_queued' : 'unresolved' : 'review_queued'
  await client.query(`UPDATE technical_demand_answers SET status=$2,candidate=$3::jsonb,answer_status=$4,
    covered_capabilities=$5,missing_capabilities=$6,missing_context=$7,next_searches=$8,reason=$9,updated_at=now() WHERE id=$1`,
    [snapshot.answer_id,state,JSON.stringify(candidate),parsed.answer_status,parsed.covered_capabilities,parsed.missing_capabilities,parsed.missing_context,parsed.next_searches,parsed.reason])
  if (!review || approved) {
    const type=review ? 'technical_answer_publication' : 'technical_answer_review'
    const next=await enqueue(client,{type,stage:review ? 'publish' : 'deep_review',priority:165,
      queueClass:'demand',reasoningEffort:review ? 'low' : 'medium',knowledgeDemandId:task.knowledge_demand_id!,
      dedupeKey:`technical:${snapshot.answer_id}:${review ? 'publish' : 'review'}`,
      payload:{...snapshot,proposed_answer:{...parsed,candidate}}})
    await client.query(`UPDATE technical_demand_answers SET ${review ? 'publication_task_id' : 'review_task_id'}=$2 WHERE id=$1`,[snapshot.answer_id,next])
  }
  if (review && !approved) await recordTechnicalGap(client,task.knowledge_demand_id!,parsed)
  return { answer_id:snapshot.answer_id,answer_status:parsed.answer_status,approved:review ? approved : undefined,
    missing_capabilities:parsed.missing_capabilities,evidence_fragments:snapshot.evidence.length }
}

async function recordTechnicalGap(client:Client,demandId:string,answer:{answer_status:string;missing_context:string[];missing_capabilities:string[];next_searches:string[];reason:string}) {
  await client.query(`UPDATE knowledge_demands SET status='unresolved',replay_status=$2,
    last_error_code=CASE WHEN cardinality($3::text[])>0 THEN 'CONTEXT_REQUIRED' ELSE 'TECHNICAL_EVIDENCE_INCOMPLETE' END,
    next_retry_at=now(),replayed_at=now() WHERE id=$1`,[demandId,answer.answer_status,answer.missing_context])
  await client.query(`UPDATE knowledge_demand_diagnostics SET replay_result=$2::jsonb
    WHERE id=(SELECT id FROM knowledge_demand_diagnostics WHERE knowledge_demand_id=$1 ORDER BY created_at DESC LIMIT 1)`,
    [demandId,JSON.stringify({answer_status:answer.answer_status,missing_context:answer.missing_context,
      missing_capabilities:answer.missing_capabilities,next_searches:answer.next_searches,reason:answer.reason})])
}

export async function publishTechnicalAnswer(client: DatabaseClient, task: PipelineTaskRow): Promise<Record<string, unknown>> {
  const {snapshot,current}=await currentSnapshot(client,task)
  if (!current) return {superseded:true}
  const approved=parseTechnicalReview(task.payload['proposed_answer'])
  if (!approved.approved || !approved.candidate) throw new Error('TECHNICAL_UNREVIEWED_PUBLICATION')
  const candidate=bindTechnicalCandidate(approved.candidate,snapshot.evidence,`${snapshot.stable_key}.${approved.candidate.record_type}`,new Date().toISOString().slice(0,10))
  assertTechnicalReviewCoverage(approved,{questionKey:snapshot.question_key,requestedContext:technicalRequestContext('',snapshot.requested_context),requiredCapabilities:snapshot.required_capabilities},candidate)
  assertNoPrivateEcho(candidate,snapshot.question,snapshot.evidence)
  const revision=await createDomainKnowledgeRevision(client,technicalDomainId,candidate,{createdBy:'researcher',validationLevel:'documentation_reviewed'})
  await publishKnowledgeBatch(client,[{itemId:revision.itemId,revisionId:revision.revisionId}],'Reviewed technical user-gap answer')
  await client.query(`UPDATE technical_demand_answers SET status='published',revision_id=$2,updated_at=now() WHERE id=$1`,[snapshot.answer_id,revision.revisionId])
  const demandContext=await client.query<{context:Record<string,unknown>}>('SELECT context FROM knowledge_demands WHERE id=$1',[task.knowledge_demand_id])
  const replay=await lookupTechnicalAnswer(client,snapshot.question,demandContext.rows[0]!.context)
  // Replay the exact private binding, not the FTS score of related facts.
  const active=await client.query('SELECT 1 FROM active_knowledge_state WHERE revision_id=$1',[revision.revisionId])
  const complete=approved.answer_status==='complete' && active.rows.length>0 && replay.answer_status==='complete'
  if (complete) await client.query(`UPDATE knowledge_demands SET status='published',replay_status='complete',
    result_revision_id=$2,result_release_id=(SELECT release_id FROM active_release),
    completed_at=now(),replayed_at=now(),last_error_code=NULL WHERE id=$1`,[task.knowledge_demand_id,revision.revisionId])
  else await recordTechnicalGap(client,task.knowledge_demand_id!,approved)
  return {revision_id:revision.revisionId,answer_status:complete ? 'complete' : 'partial',original_question_replayed:complete}
}
