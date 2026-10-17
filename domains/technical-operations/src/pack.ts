import { coreKnowledgeCandidateSchema, type DomainPack } from '@clideck/domain-kit'
import { technicalRequestContext } from './routing.js'
import { candidateSchema,contextSchema,publicRecordSchema,type PackCandidate,type PackContext,type PackPublicRecord } from './schemas.js'

export const domainPack: DomainPack<PackContext,PackCandidate,PackPublicRecord> = {
  manifest: {
    schema_version:'1',id:'technical-operations',version:'1.0.0',display_name:'Technical Operations',
    description:'Source-backed macOS/Linux, Node/Python, developer-tool and API diagnostics and workflows. Operating-system and component versions remain separate.',
    core_compatibility:{minimum:'1.0.0',maximum:'1.0.0'},
    context_dimensions:[
      {key:'operating_system',display_name:'Operating system',description:'Operating system explicitly supported by source evidence.',value_type:'string',required:false},
      {key:'operating_system_version',display_name:'Operating system version',description:'Documented OS version, separate from a runtime or library version.',value_type:'string',required:false},
      {key:'component',display_name:'Component',description:'Primary runtime, library, developer tool or API.',value_type:'string',required:false},
      {key:'component_version',display_name:'Component version',description:'Component version explicitly supported by source evidence.',value_type:'string',required:false},
      {key:'shell_environment',display_name:'Shell',description:'Requested command environment.',value_type:'string',required:false}
    ],
    record_types:['command','workflow','diagnostic','concept','change','upgrade'].map(id=>({id,display_name:id,description:`Source-backed technical ${id}.`})),
    capabilities:{search:true,workflows:true,continuous_learning:true,artifacts:false,spatial:false,relations:false,lab_validation:false}
  },
  contextSchema,candidateSchema,publicRecordSchema,
  searchContext:{hardKeys:['component']},
  normalizeContext(input) { return technicalRequestContext('',contextSchema.parse(input)) },
  validateCandidate(candidate) {
    const issues=[]
    if (candidate.record_type === 'workflow' && candidate.payload.procedure.length === 0) {
      issues.push({code:'WORKFLOW_STEPS_REQUIRED',message:'A workflow must contain an ordered procedure.',path:'payload.procedure'})
    }
    if (candidate.record_type === 'command' && !candidate.payload.command) {
      issues.push({code:'COMMAND_REQUIRED',message:'A command record must retain its documented syntax.',path:'payload.command'})
    }
    for (const [name,version,key] of [
      [candidate.context.component,candidate.context.component_version,'component_version'],
      [candidate.context.operating_system,candidate.context.operating_system_version,'operating_system_version']
    ] as const) {
      if (!version) continue
      const normalize=(value:string) => key === 'operating_system_version'
        ? technicalRequestContext('',{operating_system:value}).operating_system
        : technicalRequestContext('',{component:value}).component
      const requested=normalize(name ?? '')
      if (!name || !candidate.payload.documented_components.some(documented=>
        normalize(documented.name) === requested && documented.version === version)) {
        issues.push({code:'UNDOCUMENTED_VERSION_CONTEXT',message:'A versioned context requires matching documented component evidence.',path:`context.${key}`})
      }
    }
    return {valid:issues.length===0,issues}
  },
  toCoreCandidate(candidate) { return coreKnowledgeCandidateSchema.parse(candidateSchema.parse(candidate)) },
  fromCoreRevision(revision) { return publicRecordSchema.parse(revision) }
}

const fixtureQuestion='Inspect a project-authored technical fixture without changing state.'
export const conformanceFixture = {
  context:{component:'fixture-runtime',component_version:'1'},
  candidate: candidateSchema.parse({
    domain_id:'technical-operations',schema_version:'1',stable_key:'technical-operations.fixture.inspect',record_type:'diagnostic',
    title:'Project-authored technical fixture',summary:'An authored conformance sample, not production guidance.',question_patterns:[fixtureQuestion],
    context:{component:'fixture-runtime',component_version:'1'},
    payload:{answer:'Read the fixture value and compare it with the expected value.',procedure:['Read the controlled fixture.'],documented_components:[{name:'fixture-runtime',version:'1',applicability:'Only the project-owned test fixture.'}]},
    prerequisites:[],risks:[],verification:['Compare with the controlled test value.'],rollback:[],limitations:['Conformance fixture only; never publish as operational advice.'],
    dangerous:false,risk_level:'safe_read_only',confidence:.98,quality_score:.98,confidence_reason:'Project-authored conformance data exercises schema and mapping only.',last_verified_at:'2026-10-17',
    provenance:[{url:'https://example.com/technical-operations-fixture',source_kind:'pasted_text',source_ref:'fixture:technical-operations',document_type:'project_fixture',title:'Authored conformance fixture',verified_at:'2026-10-17',content_hash:`sha256:${'c'.repeat(64)}`,evidence_fragment:'Read the controlled fixture.',evidence_role:'primary'}]
  })
}
