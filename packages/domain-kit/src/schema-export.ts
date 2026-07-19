import { z } from 'zod'

import { domainPackManifestV1Schema } from './manifest.js'
import type { DomainPack } from './pack.js'

export type JsonSchemaDocument = Record<string, unknown>

export type DomainPackJsonSchemas = {
  manifest: JsonSchemaDocument
  context: JsonSchemaDocument
  candidate: JsonSchemaDocument
  public_record: JsonSchemaDocument
}

function exportSchema(
  schema: z.ZodType,
  id: string,
): JsonSchemaDocument {
  return {
    $id: id,
    ...z.toJSONSchema(schema, {
      target: 'draft-2020-12',
      unrepresentable: 'any'
    })
  }
}

export function exportDomainPackJsonSchemas(
  pack: DomainPack,
): DomainPackJsonSchemas {
  const base = `https://schemas.clideck.com/domain-packs/${pack.manifest.id}/${pack.manifest.version}`
  return {
    manifest: exportSchema(
      domainPackManifestV1Schema,
      `${base}/manifest.schema.json`,
    ),
    context: exportSchema(
      pack.contextSchema,
      `${base}/context.schema.json`,
    ),
    candidate: exportSchema(
      pack.candidateSchema,
      `${base}/candidate.schema.json`,
    ),
    public_record: exportSchema(
      pack.publicRecordSchema,
      `${base}/public-record.schema.json`,
    )
  }
}
