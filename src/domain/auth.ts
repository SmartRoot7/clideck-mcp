import type { Database } from '../db.js'
import { sha256 } from '../crypto.js'

export type PublicActor =
  | { kind: 'anonymous' }
  | {
      kind: 'tenant'
      principalId: string
      tenantId: string
      role: 'tenant_client'
    }

export async function resolvePublicActor(
  database: Database,
  authorizationHeader: string | undefined,
): Promise<PublicActor> {
  if (!authorizationHeader) return { kind: 'anonymous' }

  const match = /^Bearer ([A-Za-z0-9._~-]{32,512})$/.exec(authorizationHeader)
  if (!match?.[1]) return { kind: 'anonymous' }

  const tokenHash = sha256(match[1])
  const result = await database.query<{
    id: string
    tenant_id: string
    role: 'tenant_client'
  }>(
    `UPDATE principals
       SET last_used_at = now()
     WHERE token_hash = $1
       AND enabled
       AND role = 'tenant_client'
       AND tenant_id IS NOT NULL
     RETURNING id, tenant_id, role`,
    [tokenHash],
  )

  const row = result.rows[0]
  if (!row) return { kind: 'anonymous' }

  return {
    kind: 'tenant',
    principalId: row.id,
    tenantId: row.tenant_id,
    role: row.role
  }
}
