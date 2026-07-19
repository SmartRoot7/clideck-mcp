import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import {
  domainIdSchema,
  exportDomainPackJsonSchemas,
  runDomainPackConformance,
  type DomainPack,
  type DomainPackConformanceFixture
} from '@clideck/domain-kit'

type DomainModule = {
  domainPack?: DomainPack
  conformanceFixture?: DomainPackConformanceFixture
  networkConformanceFixture?: DomainPackConformanceFixture
}

function argumentValue(arguments_: string[], flag: string): string | undefined {
  const index = arguments_.indexOf(flag)
  return index >= 0 ? arguments_[index + 1] : undefined
}

export async function validateDomainPack(input: {
  id: string
  workspaceRoot?: string
  exportDirectory?: string
}) {
  const id = domainIdSchema.parse(input.id)
  const workspaceRoot = resolve(input.workspaceRoot ?? process.cwd())
  const modulePath = resolve(workspaceRoot, 'domains', id, 'src/index.ts')
  const module = await import(pathToFileURL(modulePath).href) as DomainModule
  if (!module.domainPack) {
    throw new Error(`DOMAIN_PACK_EXPORT_MISSING:${id}`)
  }
  const fixture =
    module.conformanceFixture ?? module.networkConformanceFixture
  if (!fixture) {
    throw new Error(`DOMAIN_CONFORMANCE_FIXTURE_MISSING:${id}`)
  }
  const report = runDomainPackConformance(module.domainPack, fixture)
  const schemas = exportDomainPackJsonSchemas(module.domainPack)
  if (input.exportDirectory) {
    const output = resolve(input.exportDirectory)
    await mkdir(output, { recursive: true })
    for (const [name, schema] of Object.entries(schemas)) {
      await writeFile(
        join(output, `${name.replace('_', '-')}.schema.json`),
        `${JSON.stringify(schema, null, 2)}\n`,
        'utf8',
      )
    }
  }
  return {
    ...report,
    pack_version: module.domainPack.manifest.version,
    schema_documents: Object.keys(schemas).length
  }
}

try {
  const id = argumentValue(process.argv.slice(2), '--id')
  if (!id) {
    throw new Error('Usage: pnpm domain:validate -- --id <domain-id>')
  }
  const report = await validateDomainPack({
    id,
    ...(argumentValue(process.argv.slice(2), '--export-dir')
      ? {
          exportDirectory: argumentValue(
            process.argv.slice(2),
            '--export-dir',
          )!
        }
      : {})
  })
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  )
  process.exitCode = 1
}
