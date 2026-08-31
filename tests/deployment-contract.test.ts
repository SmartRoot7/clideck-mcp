import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

describe('production database role contract', () => {
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
    expect(pipeline).toMatch(
      /INSERT INTO pipeline_events[\s\S]*?query_timeout: 30_000/,
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
