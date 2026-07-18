import { z } from 'zod'

type JsonObject = Record<string, unknown>

const supportedScalarKeys = new Set([
  'type',
  'enum',
  'const',
  'description',
  '$ref'
])

function isJsonObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isNullable(schema: JsonObject): boolean {
  if (schema['type'] === 'null') return true
  if (
    Array.isArray(schema['type']) &&
    schema['type'].includes('null')
  ) {
    return true
  }
  return Array.isArray(schema['anyOf']) && schema['anyOf'].some(
    (entry) => isJsonObject(entry) && entry['type'] === 'null',
  )
}

function nullable(schema: JsonObject): JsonObject {
  return isNullable(schema)
    ? schema
    : {
        anyOf: [
          schema,
          { type: 'null' }
        ]
      }
}

function normalizeSchemaNode(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeSchemaNode(entry))
  }
  if (!isJsonObject(value)) return value

  const properties = isJsonObject(value['properties'])
    ? value['properties']
    : undefined
  if (properties) {
    const originallyRequired = new Set(
      Array.isArray(value['required'])
        ? value['required'].filter(
            (entry): entry is string => typeof entry === 'string',
          )
        : [],
    )
    const normalizedProperties: JsonObject = {}
    for (const [key, propertySchema] of Object.entries(properties)) {
      const normalized = normalizeSchemaNode(propertySchema)
      if (!isJsonObject(normalized)) {
        throw new Error(`Invalid JSON Schema property: ${key}`)
      }
      normalizedProperties[key] = originallyRequired.has(key)
        ? normalized
        : nullable(normalized)
    }

    const normalizedObject: JsonObject = {
      type: 'object',
      properties: normalizedProperties,
      required: Object.keys(normalizedProperties),
      additionalProperties: false
    }
    if (typeof value['description'] === 'string') {
      normalizedObject['description'] = value['description']
    }
    return normalizedObject
  }

  const normalized: JsonObject = {}
  for (const key of supportedScalarKeys) {
    if (value[key] !== undefined) normalized[key] = value[key]
  }
  if (value['items'] !== undefined) {
    normalized['items'] = normalizeSchemaNode(value['items'])
  }
  if (Array.isArray(value['anyOf'])) {
    normalized['anyOf'] = value['anyOf'].map(
      (entry) => normalizeSchemaNode(entry),
    )
  }
  if (isJsonObject(value['$defs'])) {
    normalized['$defs'] = Object.fromEntries(
      Object.entries(value['$defs']).map(([key, definition]) => [
        key,
        normalizeSchemaNode(definition)
      ]),
    )
  }
  return normalized
}

export function openAiStrictJsonSchema(schema: z.ZodType): JsonObject {
  const generated = z.toJSONSchema(schema, {
    target: 'draft-7',
    unrepresentable: 'any'
  })
  const normalized = normalizeSchemaNode(generated)
  if (!isJsonObject(normalized) || normalized['type'] !== 'object') {
    throw new Error('A structured-output schema must have an object root.')
  }
  return normalized
}

export function omitNullObjectProperties(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => omitNullObjectProperties(entry))
  }
  if (!isJsonObject(value)) return value
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entry]) => entry !== null)
      .map(([key, entry]) => [key, omitNullObjectProperties(entry)]),
  )
}
