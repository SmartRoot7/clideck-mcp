import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

describe('production database role contract', () => {
  it('aggregates admin summary metrics once per large table', async () => {
    const admin = await readFile(
      resolve(process.cwd(), 'src/domain/admin.ts'),
      'utf8',
    )
    const summary = admin.slice(
      admin.indexOf('source_stats AS ('),
      admin.indexOf('snapshot AS ('),
    )

    expect(summary).toContain('knowledge_stats AS (')
    expect(summary).toContain('task_stats AS (')
    expect(summary).toContain('agent_stats AS (')
    expect(summary.match(/FROM knowledge_candidates/g)).toHaveLength(1)
    expect(summary.match(/FROM agent_runs/g)).toHaveLength(1)
    expect(summary).not.toMatch(
      /\(SELECT count\(\*\)[\s\S]*?FROM knowledge_candidates/,
    )
  })

  it('does not reject valid discovery output based on CLI event telemetry', async () => {
    const coordinator = await readFile(
      resolve(process.cwd(), 'src/cli/pipeline-coordinator.ts'),
      'utf8',
    )

    expect(coordinator).not.toContain('WEB_SEARCH_NOT_OBSERVED')
    expect(coordinator).not.toContain('webSearchUsed')
  })

  it('lets the admin and demo overview read scoped AI circuit telemetry', async () => {
    const grants = await readFile(
      resolve(process.cwd(), 'ops/sql/grants.sql'),
      'utf8',
    )

    expect(grants).toMatch(
      /GRANT SELECT ON\s+[\s\S]*?pipeline_ai_circuits\s+TO clideck_mcp_admin;/,
    )
  })

  it('lets the mechanical worker inspect scoped AI circuits', async () => {
    const grants = await readFile(
      resolve(process.cwd(), 'ops/sql/grants.sql'),
      'utf8',
    )

    expect(grants).toMatch(
      /GRANT SELECT ON\s+[\s\S]*?pipeline_ai_circuits[\s\S]*?TO clideck_mcp_worker;/,
    )
  })

  it('lets the researcher scheduler inspect active reprocess runs', async () => {
    const grants = await readFile(
      resolve(process.cwd(), 'ops/sql/grants.sql'),
      'utf8',
    )

    expect(grants).toMatch(
      /GRANT SELECT ON[\s\S]*?source_processing_runs,[\s\S]*?intake_jobs,[\s\S]*?intake_job_sources,[\s\S]*?TO clideck_mcp_researcher;/,
    )
    expect(grants).toMatch(
      /GRANT SELECT ON[\s\S]*?context_aliases,[\s\S]*?software_families,[\s\S]*?knowledge_applicability_index,[\s\S]*?public_active_knowledge,[\s\S]*?TO clideck_mcp_researcher;/,
    )
    expect(grants).toMatch(
      /GRANT UPDATE \(status, result, updated_at\)\s+ON intake_job_sources TO clideck_mcp_researcher;/,
    )
    expect(grants).toMatch(
      /GRANT UPDATE \(status, completed_at, updated_at\)\s+ON intake_jobs TO clideck_mcp_researcher;/,
    )
  })

  it('applies production grants before role-sensitive preflight tests', async () => {
    const deploy = await readFile(
      resolve(process.cwd(), 'ops/scripts/deploy-production.sh'),
      'utf8',
    )
    const grantsAt = deploy.indexOf('< ops/sql/grants.sql')
    const testsAt = deploy.indexOf('pnpm test')

    expect(grantsAt).toBeGreaterThan(0)
    expect(testsAt).toBeGreaterThan(grantsAt)
  })

  it('keeps unknown-context revisions outside applicability conservation', async () => {
    const reindex = await readFile(
      resolve(process.cwd(), 'src/cli/reindex-applicability.ts'),
      'utf8',
    )

    expect(reindex).toContain(
      'count(*) FILTER (WHERE vendor_id IS NOT NULL)::int AS count',
    )
    expect(reindex).toContain(
      'count(*) FILTER (WHERE vendor_id IS NULL)::int',
    )
    expect(reindex).toMatch(
      /count\(\*\)::int AS processed,[\s\S]*FROM target_revisions/,
    )
  })

  it('treats a lost circuit probe race as standby instead of an exception', async () => {
    const pipeline = await readFile(
      resolve(process.cwd(), 'src/domain/pipeline.ts'),
      'utf8',
    )

    expect(pipeline).not.toContain(
      "throw new Error('AI_CIRCUIT_PROBE_NOT_AVAILABLE')",
    )
    expect(pipeline).toMatch(
      /if \(!probe\.rows\[0\]\) \{[\s\S]*?reason: 'circuit_cooldown'[\s\S]*?pipeline_state: 'scoped_ai_circuit_open'/,
    )
  })

  it('constructs Terra fallback only for explicitly allowed Medium work', async () => {
    const pipeline = await readFile(
      resolve(process.cwd(), 'src/domain/pipeline.ts'),
      'utf8',
    )

    expect(pipeline).not.toContain(
      "throw new Error('PIPELINE_TERRA_FALLBACK_NOT_ALLOWED')",
    )
    expect(pipeline).toMatch(
      /const terraFallbackAllowed = supportsTerraFallback\([\s\S]*?matchingCircuit && !expiredCircuit &&[\s\S]*?terraFallbackAllowed[\s\S]*?\? fallbackPipelineModel/,
    )
  })

  it('allows serialized checkpoints and audit events to outlive fast reads', async () => {
    const publication = await readFile(
      resolve(process.cwd(), 'src/domain/publication.ts'),
      'utf8',
    )
    const pipeline = await readFile(
      resolve(process.cwd(), 'src/domain/pipeline.ts'),
      'utf8',
    )

    expect(publication).toContain(
      'const publicationSerializationTimeoutMs = 60_000',
    )
    expect(publication).toMatch(
      /INSERT INTO release_items[\s\S]*?query_timeout: publicationSerializationTimeoutMs/,
    )
    const compensatingPublication = publication.slice(
      publication.indexOf('async function publishCompensatingChanges'),
      publication.indexOf('export async function deactivatePublishedCandidates'),
    )
    expect(compensatingPublication).toMatch(
      /INSERT INTO release_items[\s\S]*?query_timeout: publicationSerializationTimeoutMs/,
    )
    expect(pipeline).toMatch(
      /INSERT INTO pipeline_events[\s\S]*?query_timeout: 30_000/,
    )
  })

  it('does not relock sources with live mechanical work', async () => {
    const pipeline = await readFile(
      resolve(process.cwd(), 'src/domain/pipeline.ts'),
      'utf8',
    )
    const preparedBuffer = pipeline.slice(
      pipeline.indexOf('const preparationSources ='),
      pipeline.indexOf('if (available === 0) return'),
    )
    const runningReprocess = pipeline.slice(
      pipeline.indexOf('export async function queueRunningReprocessMechanicalWork'),
      pipeline.indexOf('async function reconcileSourceLanes'),
    )

    expect(preparedBuffer).toMatch(
      /NOT EXISTS \([\s\S]*?FROM pipeline_tasks task[\s\S]*?task\.task_type IN \([\s\S]*?'source_chunking'[\s\S]*?task\.status IN \('queued', 'claimed', 'running'\)/,
    )
    expect(preparedBuffer).not.toContain(
      'FOR NO KEY UPDATE OF source SKIP LOCKED',
    )
    expect(runningReprocess).toMatch(
      /NOT EXISTS \([\s\S]*?FROM pipeline_tasks task[\s\S]*?task\.processing_run_id IS NOT DISTINCT FROM run\.id[\s\S]*?'source_chunking'[\s\S]*?task\.status IN \('queued', 'claimed', 'running'\)/,
    )
  })

  it('does not lock every AI circuit row in each concurrent claim', async () => {
    const pipeline = await readFile(
      resolve(process.cwd(), 'src/domain/pipeline.ts'),
      'utf8',
    )
    const claim = pipeline.slice(pipeline.indexOf(
      'export async function claimPipelineTask',
    ))

    expect(claim).not.toMatch(
      /FROM pipeline_ai_circuits\s+FOR UPDATE/,
    )
    expect(pipeline).toContain(
      "pg_try_advisory_xact_lock(\n       hashtext('clideck-mcp:pipeline-scheduler')",
    )
  })

  it('keeps lease heartbeats and mechanical claims off the scheduler settings lock', async () => {
    const pipeline = await readFile(
      resolve(process.cwd(), 'src/domain/pipeline.ts'),
      'utf8',
    )
    const mechanicalClaim = pipeline.slice(
      pipeline.indexOf('export async function claimMechanicalPipelineTask'),
      pipeline.indexOf('export async function heartbeatMechanicalPipelineTask'),
    )
    const aiHeartbeat = pipeline.slice(
      pipeline.indexOf('export async function heartbeatPipelineTask'),
      pipeline.indexOf('async function completeTask'),
    )

    expect(mechanicalClaim).not.toMatch(
      /FROM pipeline_settings[^`]*FOR UPDATE/,
    )
    expect(aiHeartbeat).not.toMatch(
      /FROM pipeline_settings[^`]*FOR UPDATE/,
    )
  })

  it('keeps the fidelity profile lock short and retries scheduler conflicts', async () => {
    const pipeline = await readFile(
      resolve(process.cwd(), 'src/domain/pipeline.ts'),
      'utf8',
    )
    const sourceWork = pipeline.slice(
      pipeline.indexOf('async function queueSourceWork'),
      pipeline.indexOf('async function queuePublicationFromAnySource'),
    )
    const profileAt = sourceWork.indexOf(
      'INSERT INTO pipeline_quality_profiles',
    )
    const candidateLockAt = sourceWork.indexOf('FOR UPDATE OF kc SKIP LOCKED')

    expect(profileAt).toBeGreaterThan(0)
    expect(candidateLockAt).toBeGreaterThan(profileAt)
    expect(sourceWork.slice(profileAt, candidateLockAt)).toMatch(
      /ON CONFLICT \(stage, profile_key\) DO NOTHING/,
    )
    expect(sourceWork.slice(profileAt, candidateLockAt)).not.toMatch(
      /DO UPDATE SET updated_at/,
    )
    const fidelitySubmission = pipeline.slice(
      pipeline.indexOf("if (task.payload['audit_mode'] === 'fidelity')"),
      pipeline.indexOf('for (const decision of input.decisions)',
        pipeline.indexOf("if (task.payload['audit_mode'] === 'fidelity')")),
    )
    expect(fidelitySubmission).toMatch(
      /ON CONFLICT \(stage, profile_key\) DO NOTHING/,
    )
    const fidelityBodyStart = pipeline.indexOf(
      "if (task.payload['audit_mode'] === 'fidelity')",
    )
    const fidelityBody = pipeline.slice(
      fidelityBodyStart,
      pipeline.indexOf('return counts', fidelityBodyStart),
    )
    expect(fidelityBody.indexOf('UPDATE pipeline_quality_profiles')).toBeGreaterThan(
      fidelityBody.indexOf('await completeTask(client, task, counts)'),
    )
    expect(pipeline).toMatch(
      /withTransientDatabaseRetry\(\s*\(\) => withTransaction\(database, ensureStreamingWorkInTransaction\),\s*3/,
    )
  })

  it('keeps Analyze in extraction and source locks compatible with event FKs', async () => {
    const pipeline = await readFile(
      resolve(process.cwd(), 'src/domain/pipeline.ts'),
      'utf8',
    )
    const sourceWork = pipeline.slice(
      pipeline.indexOf('async function queueSourceWork'),
      pipeline.indexOf('async function queueDiscoveryWork'),
    )

    expect(sourceWork).toMatch(
      /mode === 'ai' \|\|\s*mode === 'verification'[\s\S]*?Fidelity is an asynchronous audit lane/,
    )
    expect(sourceWork).toMatch(
      /if \(mode === 'verification'\) return false\s*}\s*if \(mode === 'ai' \|\| mode === 'analysis'\)/,
    )
    expect(sourceWork).not.toMatch(
      /mode === 'verification' \|\|\s*mode === 'analysis'[\s\S]*?Fidelity is an asynchronous audit lane/,
    )
    expect(pipeline).not.toMatch(/FOR UPDATE OF (?:sc|source)/)
    expect(pipeline).toMatch(/FOR NO KEY UPDATE OF sc/)
    expect(pipeline).toMatch(/FOR NO KEY UPDATE OF source/)
  })

  it('isolates invalid legacy portable-risk candidates without masking infrastructure failures', async () => {
    const repair = await readFile(
      resolve(process.cwd(), 'src/cli/repair-portable-risk.ts'),
      'utf8',
    )

    expect(repair).toContain('SAVEPOINT portable_risk_record')
    expect(repair).toContain('ROLLBACK TO SAVEPOINT portable_risk_record')
    expect(repair).toContain("'NETWORK_DOMAIN_CANDIDATE_INVALID:'")
    expect(repair).toContain('if (!reason) throw error')
    expect(repair).toContain('skipped_invalid: skippedInvalid')
  })
})
