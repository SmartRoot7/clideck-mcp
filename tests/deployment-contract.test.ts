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
