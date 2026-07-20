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
})
