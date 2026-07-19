import { z } from 'zod'

const domainIdSchema = z.string().regex(
  /^[a-z0-9][a-z0-9-]{1,62}$/,
  'Use a lowercase domain slug between 2 and 63 characters.',
)
const extensionIdSchema = z.string().regex(
  /^[a-z][a-z0-9._-]{1,63}$/,
  'Use a lowercase extension slug between 2 and 64 characters.',
)
const semverSchema = z.string().regex(
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/,
  'Use a complete semantic version such as 1.0.0.',
)

export const domainContextDimensionSchema = z.strictObject({
  key: extensionIdSchema,
  display_name: z.string().trim().min(1).max(80),
  description: z.string().trim().min(1).max(300),
  value_type: z.enum([
    'string',
    'number',
    'boolean',
    'date',
    'enum',
    'json'
  ]),
  required: z.boolean()
})

export const domainRecordTypeSchema = z.strictObject({
  id: extensionIdSchema,
  display_name: z.string().trim().min(1).max(80),
  description: z.string().trim().min(1).max(300)
})

export const domainCapabilitiesSchema = z.strictObject({
  search: z.boolean().default(true),
  workflows: z.boolean().default(false),
  continuous_learning: z.boolean().default(false),
  artifacts: z.boolean().default(false),
  spatial: z.boolean().default(false),
  relations: z.boolean().default(false),
  lab_validation: z.boolean().default(false)
})

export const domainPackManifestV1Schema = z.strictObject({
  schema_version: z.literal('1'),
  id: domainIdSchema,
  version: semverSchema,
  display_name: z.string().trim().min(1).max(100),
  description: z.string().trim().min(10).max(500),
  core_compatibility: z.strictObject({
    minimum: semverSchema,
    maximum: semverSchema.optional()
  }),
  context_dimensions: z.array(domainContextDimensionSchema).min(1).max(32),
  record_types: z.array(domainRecordTypeSchema).min(1).max(64),
  capabilities: domainCapabilitiesSchema
}).superRefine((manifest, context) => {
  const contextKeys = manifest.context_dimensions.map((entry) => entry.key)
  const recordTypeIds = manifest.record_types.map((entry) => entry.id)
  if (new Set(contextKeys).size !== contextKeys.length) {
    context.addIssue({
      code: 'custom',
      path: ['context_dimensions'],
      message: 'Context dimension keys must be unique.'
    })
  }
  if (new Set(recordTypeIds).size !== recordTypeIds.length) {
    context.addIssue({
      code: 'custom',
      path: ['record_types'],
      message: 'Record type IDs must be unique.'
    })
  }
})

export type DomainPackManifestV1 = z.infer<
  typeof domainPackManifestV1Schema
>

export {
  domainIdSchema,
  extensionIdSchema,
  semverSchema
}
