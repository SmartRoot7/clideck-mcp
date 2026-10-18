import { readFile } from 'node:fs/promises'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createPublicMcpServer } from '../src/mcp/public-server.js'
import { createLogger } from '../src/logger.js'
import { createMetrics } from '../src/metrics.js'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import pg from 'pg'
import type { Database } from '../src/db.js'
import { sha256, sha256Label } from '../src/crypto.js'
import { integrationDatabaseUrl,createTestConfig } from './helpers.js'
import { queueUnknownKnowledgeDemand, getKnowledgeLearningProgress, reportKnowledgeGap } from '../src/domain/mcp-observability.js'
import { ensurePipelineWork,claimPipelineTask,submitTechnicalAnswer,publishTechnicalPipelineAnswer,completeMechanicalPipelineTask } from '../src/domain/pipeline.js'
import { lookupTechnicalAnswer,technicalLegacyAnswer,technicalFeedbackHash } from '../src/domain/technical-demand.js'
import { technicalQuestionKey } from '../src/domain/technical-learning.js'
import { createDomainKnowledgeRevision } from '../src/domain/domain-knowledge.js'
import { technicalRequestContext, type TechnicalAnswerDraft } from '@clideck/domain-technical-operations'
import { conformanceFixture } from '../domains/technical-operations/src/pack.js'
import { executionProtocolVersion } from '@clideck/admin-contracts'
import { publicKnowledgeSchema } from '../src/domain/schemas.js'
import { queryDomainKnowledgeOutputSchema } from '../src/domain/domain-tool-schemas.js'

const suite=integrationDatabaseUrl ? describe : describe.skip
suite('original-question technical learning',()=>{
 const pool=new pg.Pool({connectionString:integrationDatabaseUrl,max:2})
 afterAll(()=>pool.end())
 async function isolated(run:(db:Database,client:pg.PoolClient)=>Promise<void>) {
  const client=await pool.connect();await client.query('BEGIN')
  const db={query:client.query.bind(client),connect:async()=>({query:(sql:string|pg.QueryConfig,values?:unknown[])=>
   typeof sql==='string' && /^(BEGIN|COMMIT|ROLLBACK)$/.test(sql.trim()) ? Promise.resolve({rows:[]}) : client.query(sql,values),release:()=>undefined})} as unknown as Database
  try {await client.query("UPDATE pipeline_tasks SET status='cancelled' WHERE status IN ('queued','claimed','running')");
    await client.query("UPDATE agent_runs SET status='cancelled',completed_at=now() WHERE status='running'");
    await client.query("UPDATE knowledge_demands SET status='published'");await client.query('DELETE FROM pipeline_model_circuits');
    await client.query('UPDATE pipeline_settings SET enabled=true,max_concurrent_ai_runs=8 WHERE singleton');await run(db,client)
  }finally {await client.query('ROLLBACK');client.release()}
 }
 async function publicQuery(db:Database,name:string,args:Record<string,unknown>) {
  const config=createTestConfig(),server=createPublicMcpServer({config,database:db,quarantineDatabase:db,
    logger:createLogger(config),metrics:createMetrics(),actor:{kind:'anonymous'},clientKey:'technical-fixture',clientAddress:'127.0.0.1',requestId:randomUUID()})
  const client=new Client({name:'technical-fixture',version:'1.0.0'})
  const [left,right]=InMemoryTransport.createLinkedPair()
  try {await Promise.all([client.connect(left),server.connect(right)]);return await client.callTool({name,arguments:args})}
  finally {await client.close();await server.close()}
 }
 const question=()=>`Inspect a Python library fixture without modifying configuration, test ${randomUUID()}`
 const context={operating_system:'macOS',operating_system_version:'27.0.1',component:'fixture-runtime',component_version:'1'}
 async function fixture(db:Database,client:pg.PoolClient, q=question(),requestedContext:Record<string,unknown>=context,beforeQueue?:(id:string)=>Promise<void>) {
  const id=await queueUnknownKnowledgeDemand(db,'query_domain_knowledge',{question:q,context:requestedContext},{domain_id:'technical-operations',unknown:true})
  await client.query("UPDATE pipeline_tasks SET status='cancelled' WHERE knowledge_demand_id=$1",[id])
  await client.query("UPDATE knowledge_demands SET diagnosis_status='completed',status='queued' WHERE id=$1",[id])
  const diagnosticTask=await client.query(`INSERT INTO pipeline_tasks(task_type,stage,status,dedupe_key,payload) VALUES ('demand_diagnosis','diagnose','completed',$1,'{}') RETURNING id`,[randomUUID()])
  await client.query(`INSERT INTO knowledge_demand_diagnostics(knowledge_demand_id,pipeline_task_id,diagnosis_version,status,failure_class,answer_status,
    canonical_context,subquestions,existing_coverage,missing_capabilities,search_expansions,document_roles,recommended_action,reasoning_summary,replay_result,artifact_hash)
    VALUES ($1,$2,'demand-v1','completed','missing_knowledge','unknown','{}','[{"capability":"inspect-fixture","status":"missing"}]','{}',ARRAY['inspect-fixture'],ARRAY['fixture docs'],ARRAY['commands'],'targeted_discovery','Find the fixture evidence.','{}',$3)`,[id,diagnosticTask.rows[0].id,sha256Label(q)])
  const source=await client.query(`INSERT INTO source_candidates(knowledge_demand_id,canonical_url,document_type,title,status,source_kind,discovered_by)
    VALUES ($1,$2,'command_reference','Controlled fixture','completed','official_web','fixture') RETURNING id`,[id,`https://example.com/${randomUUID()}`])
  const artifact=await client.query(`INSERT INTO source_artifacts(source_candidate_id,storage_path,content_hash,media_type,byte_size,status)
    VALUES ($1,'fixture.txt',$2,'text/plain',32,'chunked') RETURNING id`,[source.rows[0].id,sha256Label(q)])
  for(let i=0;i<22;i++) await client.query(`INSERT INTO source_fragments(source_artifact_id,ordinal,content,content_hash,status)
    VALUES ($1,$2,$3,$4,'analyzed')`,[artifact.rows[0].id,i,`Read the controlled fixture. Evidence span ${i}.`,sha256Label('span'+i)])
  await beforeQueue?.(id!)
  await ensurePipelineWork(db)
  const task=(await client.query("SELECT * FROM pipeline_tasks WHERE knowledge_demand_id=$1 AND task_type='technical_answer' AND status='queued'",[id])).rows[0]
  expect(task).toBeTruthy()
  return {id:id!,q,task}
 }
 async function lease(client:pg.PoolClient,id:string) {
  const token='fixture-lease-token-'.repeat(3)
  await client.query("UPDATE pipeline_tasks SET status='running',lease_until=now()+interval '1 hour',lease_token_hash=$2,attempts=1 WHERE id=$1",[id,sha256(token)])
  return token
 }
 function draft(task:Record<string,any>,complete=true):TechnicalAnswerDraft {
  const evidence=task['payload'].evidence[0]
  return {question_key:task['payload'].question_key,answer_status:complete?'complete':'partial',covered_capabilities:complete?['inspect-fixture']:[],
   candidate:{...conformanceFixture.candidate,provenance:[{...conformanceFixture.candidate.provenance[0]!,url:evidence.canonical_url,content_hash:evidence.content_hash,evidence_fragment:'Read the controlled fixture.'}]},
   missing_capabilities:complete?[]:['inspect-fixture'],missing_context:[],next_searches:[],reason:'Official fixture evidence supports the documented inspection.'}
 }
 it('queues technical intake without a device catalogue and deduplicates it with API permissions',()=>isolated(async(db,client)=>{
  await client.query('SET LOCAL ROLE clideck_mcp_api')
  const q=question(),input={question:q,context}
  const first=await queueUnknownKnowledgeDemand(db,'query_domain_knowledge',input,{domain_id:'technical-operations',unknown:true})
  expect(await queueUnknownKnowledgeDemand(db,'query_domain_knowledge',input,{domain_id:'technical-operations',unknown:true})).toBe(first)
  expect((await client.query('SELECT domain_id,last_error_code FROM knowledge_demands WHERE id=$1',[first])).rows[0]).toEqual({domain_id:'technical-operations',last_error_code:null})
  expect(await lookupTechnicalAnswer(db,q,context)).toMatchObject({answer_status:'unknown'})
  const constrained=await queueUnknownKnowledgeDemand(db,'query_domain_knowledge',{question:q,context:{...context,model:'Intel MacBook',runtime_mode:'recovery',architecture:'x86_64'}},{domain_id:'technical-operations',unknown:true})
  expect(constrained).not.toBe(first)
  expect((await client.query('SELECT context FROM knowledge_demands WHERE id=$1',[constrained])).rows[0].context).toMatchObject({model:'Intel MacBook',runtime_mode:'recovery',architecture:'x86_64'})
 }))
 it('prioritizes bounded technical synthesis and preserves Pause',()=>isolated(async(db,client)=>{
  const {task}=await fixture(db,client)
  expect(task.payload.evidence.length).toBeLessThanOrEqual(16)
  expect(Buffer.byteLength(task.payload.evidence.map((item:any)=>item.content).join(''))).toBeLessThanOrEqual(65536)
  await client.query('UPDATE pipeline_settings SET enabled=false WHERE singleton')
  expect(await claimPipelineTask(db,createTestConfig(),'pipeline-executor-01','fixture',executionProtocolVersion)).not.toHaveProperty('pipeline_task_id')
  await client.query('UPDATE pipeline_settings SET enabled=true WHERE singleton')
  const claim=await claimPipelineTask(db,createTestConfig(),'pipeline-executor-01','fixture',executionProtocolVersion)
  expect(claim['pipeline_task_id']).toBe(task.id)
  expect(claim['execution_profile']).toBe('luna')
  expect((claim['payload'] as any).question_key).toBe(task['payload'].question_key)
  expect((claim['payload'] as any).knowledge_demand).toBeUndefined()
 }))
 it('publishes only after independent complete review and exact replay through the ordinary active release',()=>isolated(async(db,client)=>{
  const {id,q,task}=await fixture(db,client)
  await client.query('SET LOCAL ROLE clideck_mcp_researcher')
  await submitTechnicalAnswer(db,{pipeline_task_id:task.id,lease_token:await lease(client,task.id),artifact:draft(task)})
  const review=(await client.query("SELECT * FROM pipeline_tasks WHERE knowledge_demand_id=$1 AND task_type='technical_answer_review'",[id])).rows[0]
  expect(review.execution_profile).toBe('luna_high')
  await submitTechnicalAnswer(db,{pipeline_task_id:review.id,lease_token:await lease(client,review.id),artifact:{...draft(task),approved:true}})
  const pub=(await client.query("SELECT id FROM pipeline_tasks WHERE knowledge_demand_id=$1 AND task_type='technical_answer_publication'",[id])).rows[0]
  await client.query('RESET ROLE');const token=await lease(client,pub.id);await client.query('SET LOCAL ROLE clideck_mcp_worker')
  const publication=await publishTechnicalPipelineAnswer(db,pub.id,token)
  expect(publication).toMatchObject({original_question_replayed:true,answer_status:'complete'})
  expect(await publishTechnicalPipelineAnswer(db,pub.id,token)).toMatchObject(publication)
  await client.query('SET LOCAL ROLE clideck_mcp_api')
  const replay=await lookupTechnicalAnswer(db,q,context)
  expect(replay.answer_status).toBe('complete');expect(replay.records).toHaveLength(1)
  const response=await publicQuery(db,'query_domain_knowledge',{domain_id:'technical-operations',question:q,context})
  expect(response.isError).not.toBe(true)
  expect(response.structuredContent).toMatchObject({answer_status:'complete',answers:[{domain_id:'technical-operations'}]})
  expect(publicKnowledgeSchema.safeParse(technicalLegacyAnswer(replay.records[0]!)).success).toBe(true)
  const publicText=JSON.stringify(replay.records)
  expect(publicText).not.toContain(q);expect(publicText).not.toContain(id)
  expect(replay.records[0]!.context).toEqual({component:'fixture-runtime',component_version:'1'})
  expect((await getKnowledgeLearningProgress(db,id))?.status).toBe('published')
  const {records,crossPlatformRecords,...status}=replay
  expect(queryDomainKnowledgeOutputSchema.safeParse({...status,answers:records,cross_platform_examples:crossPlatformRecords}).success).toBe(true)
  expect((await lookupTechnicalAnswer(db,q,{...context,component_version:'2'})).answer_status).not.toBe('complete')
  expect((await lookupTechnicalAnswer(db,q,{...context,runtime_mode:'recovery'})).answer_status).not.toBe('complete')
  expect((await lookupTechnicalAnswer(db,q,{...context,model:'Intel MacBook'})).answer_status).not.toBe('complete')
  expect((await lookupTechnicalAnswer(db,q,{...context,architecture:'x86_64'})).answer_status).not.toBe('complete')
  const feedback=await queueUnknownKnowledgeDemand(db,'query_domain_knowledge',{question:q,context},{domain_id:'technical-operations',unknown:true,feedback_reason:'The private fixture is different.',reported_revision_refs:[]})
  expect(feedback).toBe(id)
  expect((await lookupTechnicalAnswer(db,q,context)).answer_status).not.toBe('complete')
  await queueUnknownKnowledgeDemand(db,'query_domain_knowledge',{question:q,context},{domain_id:'technical-operations',unknown:true})
  expect((await lookupTechnicalAnswer(db,q,context)).answer_status).not.toBe('complete')
 }))
 it('reuses an existing item and appends immutable revisions with worker permissions',()=>isolated(async(_db,client)=>{
  await client.query('SET LOCAL ROLE clideck_mcp_worker')
  expect((await client.query("SELECT has_table_privilege(current_user,'knowledge_items','UPDATE') allowed")).rows[0].allowed).toBe(false)
  const candidate={...conformanceFixture.candidate,stable_key:`technical-operations.answer.${randomUUID()}`}
  const author={createdBy:'researcher',validationLevel:'documentation_reviewed'} as const
  const first=await createDomainKnowledgeRevision(client,'technical-operations',candidate,author)
  expect(await createDomainKnowledgeRevision(client,'technical-operations',candidate,author)).toEqual({...first,created:false})
  const updated=await createDomainKnowledgeRevision(client,'technical-operations',{...candidate,summary:'Updated controlled fixture inspection guidance.'},author)
  expect(updated.itemId).toBe(first.itemId)
  expect(updated.revisionId).not.toBe(first.revisionId)
  expect((await client.query('SELECT revision_number,summary FROM knowledge_revisions WHERE knowledge_item_id=$1 ORDER BY revision_number',[first.itemId])).rows).toEqual([
    {revision_number:1,summary:candidate.summary},
    {revision_number:2,summary:'Updated controlled fixture inspection guidance.'},
  ])
 }))
 it('serializes the same revision key while allowing an unrelated worker publication',()=>isolated(async(_db,client)=>{
  const candidate={...conformanceFixture.candidate,stable_key:`technical-operations.answer.${randomUUID()}`}
  const author={createdBy:'researcher',validationLevel:'documentation_reviewed'} as const
  await client.query('SAVEPOINT publication_lock')
  await client.query('SET LOCAL ROLE clideck_mcp_worker')
  await createDomainKnowledgeRevision(client,'technical-operations',candidate,author)
  await client.query('RESET ROLE')
  const other=await pool.connect()
  let pending:ReturnType<typeof createDomainKnowledgeRevision>|undefined
  try {
   await other.query('BEGIN')
   await other.query('SET LOCAL ROLE clideck_mcp_worker')
   await other.query("SET LOCAL statement_timeout='2s'")
   const unrelated={...candidate,stable_key:`technical-operations.answer.${randomUUID()}`,
    provenance:candidate.provenance.map(source=>({...source,url:`https://example.com/${randomUUID()}`}))}
   expect((await createDomainKnowledgeRevision(other,'technical-operations',unrelated,author)).created).toBe(true)
   const pid=(await other.query('SELECT pg_backend_pid() pid')).rows[0].pid
   pending=createDomainKnowledgeRevision(other,'technical-operations',candidate,author)
   void pending.catch(()=>undefined)
   let waiting=false
   for(let attempt=0;attempt<30&&!waiting;attempt++) {
    waiting=(await client.query("SELECT wait_event='advisory' waiting FROM pg_stat_activity WHERE pid=$1",[pid])).rows[0]?.waiting===true
    if(!waiting) await delay(10)
   }
   expect(waiting).toBe(true)
   await client.query('ROLLBACK TO SAVEPOINT publication_lock')
   expect((await pending).created).toBe(true)
  } finally {
   await client.query('ROLLBACK TO SAVEPOINT publication_lock')
   await pending?.catch(()=>undefined)
   await other.query('ROLLBACK')
   other.release()
  }
 }))
 it('advances unseen evidence after a partial answer and never repeats a consumed window',()=>isolated(async(db,client)=>{
  const {id,task}=await fixture(db,client)
  const firstIds=task.payload.evidence.map((item:any)=>item.id)
  await submitTechnicalAnswer(db,{pipeline_task_id:task.id,lease_token:await lease(client,task.id),artifact:draft(task,false)})
  const review=(await client.query("SELECT * FROM pipeline_tasks WHERE knowledge_demand_id=$1 AND task_type='technical_answer_review'",[id])).rows[0]
  await submitTechnicalAnswer(db,{pipeline_task_id:review.id,lease_token:await lease(client,review.id),artifact:{...draft(task,false),approved:false,next_searches:['Find official Python inspection details.']}})
  const focused=(await client.query("SELECT priority FROM pipeline_tasks WHERE knowledge_demand_id=$1 AND task_type='source_discovery' AND status='queued'",[id])).rows[0]
  expect(focused?.priority).toBe(165)
  const next=(await client.query("SELECT * FROM pipeline_tasks WHERE knowledge_demand_id=$1 AND task_type='technical_answer' AND id<>$2",[id,task.id])).rows[0]
  expect(next).toBeTruthy();expect(next.payload.previous_answer).toBeTruthy()
  expect(next.payload.evidence.some((item:any)=>!firstIds.includes(item.id))).toBe(true)
  await ensurePipelineWork(db)
  expect((await client.query("SELECT count(*)::int count FROM pipeline_tasks WHERE knowledge_demand_id=$1 AND task_type='technical_answer'",[id])).rows[0].count).toBe(2)
 }))
 it('continues public evidence research while retaining private incident evidence requirements',()=>isolated(async(db,client)=>{
  const {id,task}=await fixture(db,client)
  await submitTechnicalAnswer(db,{pipeline_task_id:task.id,lease_token:await lease(client,task.id),artifact:draft(task,false)})
  const review=(await client.query("SELECT * FROM pipeline_tasks WHERE knowledge_demand_id=$1 AND task_type='technical_answer_review'",[id])).rows[0]
  const missingContext=['Provide the timestamped application error chain for a case-specific conclusion.']
  const nextSearches=['Find official Python inspection details for the documented read-only workflow.']
  await submitTechnicalAnswer(db,{pipeline_task_id:review.id,lease_token:await lease(client,review.id),artifact:{...draft(task,false),approved:false,missing_context:missingContext,next_searches:nextSearches}})
  const focused=(await client.query("SELECT priority FROM pipeline_tasks WHERE knowledge_demand_id=$1 AND task_type='source_discovery' AND status='queued'",[id])).rows[0]
  expect(focused?.priority).toBe(165)
  const next=(await client.query("SELECT payload FROM pipeline_tasks WHERE knowledge_demand_id=$1 AND task_type='technical_answer' AND id<>$2",[id,task.id])).rows[0]
  expect(next).toBeTruthy()
  expect(await getKnowledgeLearningProgress(db,id)).toMatchObject({needs_context:true,missing_context:missingContext})
  expect((await lookupTechnicalAnswer(db,task.payload.question,context)).answer_status).not.toBe('complete')
 }))
 it('repairs existing mixed holds without reopening private-only holds or changing task leases',()=>isolated(async(db,client)=>{
  const ids:string[]=[]
  for(const mixed of [true,false]) {
   const {id,task}=await fixture(db,client);ids.push(id)
   await submitTechnicalAnswer(db,{pipeline_task_id:task.id,lease_token:await lease(client,task.id),artifact:draft(task,false)})
   const review=(await client.query("SELECT * FROM pipeline_tasks WHERE knowledge_demand_id=$1 AND task_type='technical_answer_review'",[id])).rows[0]
   await submitTechnicalAnswer(db,{pipeline_task_id:review.id,lease_token:await lease(client,review.id),artifact:{...draft(task,false),approved:false,missing_context:['Provide private incident logs.'],next_searches:mixed?['Official Python diagnostic documentation.']:[]}})
   await client.query("UPDATE knowledge_demands SET last_error_code='CONTEXT_REQUIRED' WHERE id=$1",[id])
  }
  const taskState=()=>client.query('SELECT id,status,attempts,lease_until,lease_token_hash FROM pipeline_tasks WHERE knowledge_demand_id=ANY($1::uuid[]) ORDER BY id',[ids])
  const before=(await taskState()).rows
  await client.query(await readFile(new URL('../migrations/051_technical_mixed_evidence.sql',import.meta.url),'utf8'))
  const errors=await client.query('SELECT id,last_error_code FROM knowledge_demands WHERE id=ANY($1::uuid[])',[ids])
  expect(errors.rows.find(row=>row.id===ids[0]).last_error_code).toBe('TECHNICAL_EVIDENCE_INCOMPLETE')
  expect(errors.rows.find(row=>row.id===ids[1]).last_error_code).toBe('CONTEXT_REQUIRED')
  expect((await taskState()).rows).toEqual(before)
 }))
 it('reports private evidence needs without repeatedly synthesizing the same evidence',()=>isolated(async(db,client)=>{
  const {id,q,task}=await fixture(db,client)
  await submitTechnicalAnswer(db,{pipeline_task_id:task.id,lease_token:await lease(client,task.id),artifact:{...draft(task,false),candidate:null,missing_context:['Provide the application fetch call and timestamped error chain.']}})
  const review=(await client.query("SELECT * FROM pipeline_tasks WHERE knowledge_demand_id=$1 AND task_type='technical_answer_review'",[id])).rows[0]
  await submitTechnicalAnswer(db,{pipeline_task_id:review.id,lease_token:await lease(client,review.id),artifact:{...draft(task,false),candidate:null,approved:false,missing_context:['Provide the application fetch call and timestamped error chain.']}})
  await queueUnknownKnowledgeDemand(db,'query_domain_knowledge',{question:q,context},{domain_id:'technical-operations',unknown:true})
  expect(await getKnowledgeLearningProgress(db,id)).toMatchObject({needs_context:true,status:'unresolved',message:'Provide the application fetch call and timestamped error chain.'})
  expect((await client.query("SELECT count(*)::int count FROM pipeline_tasks WHERE knowledge_demand_id=$1 AND task_type='technical_answer'",[id])).rows[0].count).toBe(1)
 }))
 it('rejects mismatched citations and private query echo',()=>isolated(async(db,client)=>{
  const {task}=await fixture(db,client);const token=await lease(client,task.id)
  const invalid=draft(task);invalid.candidate!.provenance[0]!.content_hash=sha256Label('not leased')
  await expect(submitTechnicalAnswer(db,{pipeline_task_id:task.id,lease_token:token,artifact:invalid})).rejects.toThrow('TECHNICAL_PROVENANCE_NOT_IN_TASK')
  const privateEcho=draft(task);privateEcho.candidate!.question_patterns=[task.payload.question]
  await expect(submitTechnicalAnswer(db,{pipeline_task_id:task.id,lease_token:token,artifact:privateEcho})).rejects.toThrow('TECHNICAL_PRIVATE_CONTEXT')
 }))
 it('allows all eight operator lanes to learn different unanswered technical questions',()=>isolated(async(db,client)=>{
  for(let i=0;i<8;i++) await fixture(db,client)
  const claims=[]
  for(let i=1;i<=8;i++) claims.push(await claimPipelineTask(db,createTestConfig(),`pipeline-executor-${String(i).padStart(2,'0')}`,`fixture:${i}`,executionProtocolVersion))
  expect(claims.map(claim=>claim['task_type'])).toEqual(Array(8).fill('technical_answer'))
  expect(new Set(claims.map(claim=>claim['pipeline_task_id'])).size).toBe(8)
 }))
 it('retains partial publication as partial and cannot close an incomplete independent review',()=>isolated(async(db,client)=>{
  const {id,q,task}=await fixture(db,client)
  await submitTechnicalAnswer(db,{pipeline_task_id:task.id,lease_token:await lease(client,task.id),artifact:draft(task,false)})
  const review=(await client.query("SELECT * FROM pipeline_tasks WHERE knowledge_demand_id=$1 AND task_type='technical_answer_review'",[id])).rows[0]
  const token=await lease(client,review.id)
  await expect(submitTechnicalAnswer(db,{pipeline_task_id:review.id,lease_token:token,artifact:{...draft(task,false),answer_status:'complete',approved:true}})).rejects.toThrow('TECHNICAL_REVIEW_INCOMPLETE')
  await submitTechnicalAnswer(db,{pipeline_task_id:review.id,lease_token:token,artifact:{...draft(task,false),approved:true}})
  const pub=(await client.query("SELECT id FROM pipeline_tasks WHERE knowledge_demand_id=$1 AND task_type='technical_answer_publication'",[id])).rows[0]
  expect(await publishTechnicalPipelineAnswer(db,pub.id,await lease(client,pub.id))).toMatchObject({original_question_replayed:false,answer_status:'partial'})
  expect((await lookupTechnicalAnswer(db,q,context)).answer_status).toBe('partial')
  expect((await getKnowledgeLearningProgress(db,id))?.status).not.toBe('published')
 }))
 it('supersedes an in-flight answer after the original feedback changes',()=>isolated(async(db,client)=>{
  const {id,task}=await fixture(db,client)
  const token=await lease(client,task.id)
  await client.query("UPDATE knowledge_demands SET context=context || '{\"feedback_reason\":\"A newly supplied failure changes the original question.\"}'::jsonb WHERE id=$1",[id])
  expect(await submitTechnicalAnswer(db,{pipeline_task_id:task.id,lease_token:token,artifact:draft(task)})).toEqual({superseded:true})
  expect((await client.query("SELECT status FROM technical_demand_answers WHERE draft_task_id=$1",[task.id])).rows[0].status).toBe('superseded')
  expect((await client.query("SELECT count(*)::int count FROM pipeline_tasks WHERE knowledge_demand_id=$1 AND task_type IN ('technical_answer_review','technical_answer_publication')",[id])).rows[0].count).toBe(0)
 }))

 it('routes legacy macOS queries and typed technical feedback through the public MCP schemas',()=>isolated(async(db,client)=>{
  await client.query('SET LOCAL ROLE clideck_mcp_api')
  const q=`How to inspect a Python package on macOS, fixture ${randomUUID()}?`
  const legacy=await publicQuery(db,'query_network_knowledge',{question:q,context:{operating_system:'macOS',version:'27.0.1'}})
  expect(legacy.isError).not.toBe(true)
  expect(legacy.structuredContent).toMatchObject({answer_status:'unknown',learning:{id:expect.any(String),needs_context:false}})
  const typed=await publicQuery(db,'query_domain_knowledge',{domain_id:'technical-operations',question:q,context})
  expect(typed.isError).not.toBe(true)
  const id=((typed.structuredContent as Record<string,unknown>)?.['learning'] as {id:string}).id
  const feedback=await publicQuery(db,'report_domain_knowledge_gap',{domain_id:'technical-operations',question:q,context,reason:'The requested component is not covered.'})
  expect(feedback.isError).not.toBe(true)
  expect(feedback.structuredContent).toMatchObject({learning:{id,needs_context:false}})
 }))

 it('keeps a complete legacy software replay closed despite its generic applicability label',()=>isolated(async(db,client)=>{
  const raw={operating_system:'macOS',version:'27.0.1'}
  const {id,q,task}=await fixture(db,client,question(),raw)
  const answer=draft(task);answer.candidate!.payload.documented_components.push({name:'python',applicability:'Controlled Python inspection example.'})
  await submitTechnicalAnswer(db,{pipeline_task_id:task.id,lease_token:await lease(client,task.id),artifact:answer})
  const review=(await client.query("SELECT * FROM pipeline_tasks WHERE knowledge_demand_id=$1 AND task_type='technical_answer_review'",[id])).rows[0]
  await submitTechnicalAnswer(db,{pipeline_task_id:review.id,lease_token:await lease(client,review.id),artifact:{...answer,approved:true}})
  const pub=(await client.query("SELECT id FROM pipeline_tasks WHERE knowledge_demand_id=$1 AND task_type='technical_answer_publication'",[id])).rows[0]
  await publishTechnicalPipelineAnswer(db,pub.id,await lease(client,pub.id))
  const before=(await client.query('SELECT count(*)::int count FROM knowledge_demands')).rows[0].count
  await client.query('SET LOCAL ROLE clideck_mcp_api')
  const response=await publicQuery(db,'query_network_knowledge',{question:q,context:raw})
  expect(response.isError).not.toBe(true)
  expect(response.structuredContent).toMatchObject({answer_status:'complete',answers:[{applicability:{assurance_level:'generic'}}]})
  expect((await client.query('SELECT count(*)::int count FROM knowledge_demands')).rows[0].count).toBe(before)
  expect((await getKnowledgeLearningProgress(db,id))?.status).toBe('published')
 }))

 it('puts relevant retained evidence ahead of old unrelated documents without losing document diversity',()=>isolated(async(db,client)=>{
  const relevantId='ffffffff-ffff-4fff-8fff-ffffffffffff'
  const {task}=await fixture(db,client,question(),context,async demandId=>{
    for(let i=0;i<18;i++) {
      const sourceId=i===17 ? relevantId : `00000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`
      const url=`https://example.com/${sourceId}`
      await client.query("INSERT INTO source_candidates(id,knowledge_demand_id,canonical_url,document_type,title,status,source_kind,discovered_by) VALUES ($1,$2,$3,'command_reference','Controlled evidence','completed','official_web','fixture')",[sourceId,demandId,url])
      const artifact=(await client.query("INSERT INTO source_artifacts(source_candidate_id,storage_path,content_hash,media_type,byte_size,status) VALUES ($1,'fixture.txt',$2,'text/plain',100,'chunked') RETURNING id",[sourceId,sha256Label(url)])).rows[0]
      const content=i===17 ? 'Inspect Python library fixture configuration without modifying configuration.' : 'Unrelated Apple warranty coverage.'
      await client.query("INSERT INTO source_fragments(source_artifact_id,ordinal,content,content_hash,status) VALUES ($1,0,$2,$3,'analyzed')",[artifact.id,content,sha256Label(url+content)])
    }
  })
  expect(task.payload.evidence.some((item:any)=>item.source_id===relevantId)).toBe(true)
  expect(new Set(task.payload.evidence.map((item:any)=>item.source_id)).size).toBe(16)
 }))

 it('retains all diagnosis capabilities instead of truncating the completeness requirement',()=>isolated(async(db,client)=>{
  const {id,task}=await fixture(db,client,question(),context,async demandId=>{
    const subquestions=Array.from({length:12},(_,i)=>({capability:`part-${i}`,label:`Fixture part ${i}`,status:'missing',explanation:'Controlled completeness requirement.',search_terms:['fixture']}))
    await client.query('UPDATE knowledge_demand_diagnostics SET subquestions=$2::jsonb,missing_capabilities=$3 WHERE knowledge_demand_id=$1',
      [demandId,JSON.stringify(subquestions),Array.from({length:12},(_,i)=>`additional-${i}`)])
  })
  expect(task.payload.required_capabilities).toHaveLength(24)
  await submitTechnicalAnswer(db,{pipeline_task_id:task.id,lease_token:await lease(client,task.id),artifact:draft(task)})
  const review=(await client.query("SELECT * FROM pipeline_tasks WHERE knowledge_demand_id=$1 AND task_type='technical_answer_review'",[id])).rows[0]
  await expect(submitTechnicalAnswer(db,{pipeline_task_id:review.id,lease_token:await lease(client,review.id),artifact:{...draft(task),approved:true,covered_capabilities:task.payload.required_capabilities.slice(0,20)}})).rejects.toThrow('TECHNICAL_REVIEW_INCOMPLETE')
 }))

 it('accepts a short public question phrase supported by the trusted source quote',()=>isolated(async(db,client)=>{
  const {task}=await fixture(db,client,'Read the controlled fixture.')
  await expect(submitTechnicalAnswer(db,{pipeline_task_id:task.id,lease_token:await lease(client,task.id),artifact:draft(task)})).resolves.toMatchObject({answer_status:'complete'})
 }))

 it('replays a retained redacted request without storing its private address in public knowledge',()=>isolated(async(db,client)=>{
  const {id,q,task}=await fixture(db,client,'Inspect a Python library fixture at 192.168.1.25 without changing configuration.')
  expect((await client.query('SELECT question FROM knowledge_demands WHERE id=$1',[id])).rows[0].question).not.toContain('192.168.1.25')
  await submitTechnicalAnswer(db,{pipeline_task_id:task.id,lease_token:await lease(client,task.id),artifact:draft(task)})
  const review=(await client.query("SELECT * FROM pipeline_tasks WHERE knowledge_demand_id=$1 AND task_type='technical_answer_review'",[id])).rows[0]
  await submitTechnicalAnswer(db,{pipeline_task_id:review.id,lease_token:await lease(client,review.id),artifact:{...draft(task),approved:true}})
  const pub=(await client.query("SELECT id FROM pipeline_tasks WHERE knowledge_demand_id=$1 AND task_type='technical_answer_publication'",[id])).rows[0]
  await publishTechnicalPipelineAnswer(db,pub.id,await lease(client,pub.id))
  const replay=await lookupTechnicalAnswer(db,q,context)
  expect(replay.answer_status).toBe('complete')
  expect(JSON.stringify(replay.records)).not.toContain('192.168.1.25')
 }))

 it('keeps room for unseen evidence when prior citations use old oversized UTF-8 fragments',()=>isolated(async(db,client)=>{
  const {id,task}=await fixture(db,client,question(),context,async demandId=>{
    const fragments=await client.query('SELECT fragment.id,fragment.content FROM source_fragments fragment JOIN source_artifacts artifact ON artifact.id=fragment.source_artifact_id JOIN source_candidates source ON source.id=artifact.source_candidate_id WHERE source.knowledge_demand_id=$1',[demandId])
    for(const fragment of fragments.rows) {
      const content=fragment.content+'例'.repeat(4000)
      await client.query('UPDATE source_fragments SET content=$2,content_hash=$3 WHERE id=$1',[fragment.id,content,sha256Label(content)])
    }
  })
  expect(task.payload.evidence.every((item:any)=>Buffer.byteLength(item.content)<=4096)).toBe(true)
  const answer=draft(task,false)
  answer.candidate!.provenance=task.payload.evidence.filter((item:any)=>item.content.includes('Read the controlled fixture.')).map((item:any)=>({...conformanceFixture.candidate.provenance[0]!,url:item.canonical_url,content_hash:item.content_hash,evidence_fragment:'Read the controlled fixture.'}))
  await submitTechnicalAnswer(db,{pipeline_task_id:task.id,lease_token:await lease(client,task.id),artifact:answer})
  const review=(await client.query("SELECT * FROM pipeline_tasks WHERE knowledge_demand_id=$1 AND task_type='technical_answer_review'",[id])).rows[0]
  await submitTechnicalAnswer(db,{pipeline_task_id:review.id,lease_token:await lease(client,review.id),artifact:{...answer,approved:false}})
  const next=(await client.query("SELECT payload FROM pipeline_tasks WHERE knowledge_demand_id=$1 AND task_type='technical_answer' AND id<>$2",[id,task.id])).rows[0]
  expect(next).toBeTruthy()
  expect(Buffer.byteLength(next.payload.evidence.map((item:any)=>item.content).join(''))).toBeLessThanOrEqual(65536)
 }))

})
