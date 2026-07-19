import {
  access,
  mkdir,
  readdir,
  readFile,
  writeFile
} from 'node:fs/promises'
import { basename, join, relative, resolve, sep } from 'node:path'

import { domainIdSchema } from '@clideck/domain-kit'
import { z } from 'zod'

const displayNameSchema = z.string().trim().min(1).max(100)

export type CreateDomainOptions = {
  id: string
  displayName: string
  workspaceRoot?: string
  templateRoot?: string
  destinationRoot?: string
}

function packageClassName(domainId: string): string {
  return domainId
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('')
}

export function renderDomainTemplate(
  input: string,
  values: { id: string; displayName: string },
): string {
  return input
    .replaceAll('__DOMAIN_ID__', values.id)
    .replaceAll('__DISPLAY_NAME__', values.displayName)
    .replaceAll('__DOMAIN_CLASS__', packageClassName(values.id))
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function renderDirectory(
  sourceRoot: string,
  destinationRoot: string,
  values: { id: string; displayName: string },
): Promise<void> {
  for (const entry of await readdir(sourceRoot, { withFileTypes: true })) {
    const source = join(sourceRoot, entry.name)
    const renderedName = renderDomainTemplate(entry.name, values)
    const destination = join(destinationRoot, renderedName)
    if (entry.isDirectory()) {
      await mkdir(destination, { recursive: true })
      await renderDirectory(source, destination, values)
      continue
    }
    if (!entry.isFile()) continue
    const content = await readFile(source, 'utf8')
    await writeFile(
      destination,
      renderDomainTemplate(content, values),
      { encoding: 'utf8', flag: 'wx' },
    )
  }
}

export async function createDomainPack(
  options: CreateDomainOptions,
): Promise<string> {
  const id = domainIdSchema.parse(options.id)
  const displayName = displayNameSchema.parse(options.displayName)
  const workspaceRoot = resolve(options.workspaceRoot ?? process.cwd())
  const templateRoot = resolve(
    options.templateRoot ?? join(workspaceRoot, 'templates/domain-pack'),
  )
  const domainsRoot = resolve(
    options.destinationRoot ?? join(workspaceRoot, 'domains'),
  )
  const destination = resolve(domainsRoot, id)
  if (
    destination !== join(domainsRoot, id) ||
    relative(domainsRoot, destination).startsWith(`..${sep}`)
  ) {
    throw new Error('DOMAIN_DESTINATION_OUTSIDE_WORKSPACE')
  }
  if (!(await pathExists(templateRoot))) {
    throw new Error(`DOMAIN_TEMPLATE_NOT_FOUND:${templateRoot}`)
  }
  if (await pathExists(destination)) {
    throw new Error(`DOMAIN_DESTINATION_EXISTS:${destination}`)
  }
  await mkdir(destination, { recursive: true })
  try {
    await renderDirectory(templateRoot, destination, { id, displayName })
  } catch (error) {
    throw new Error(
      `DOMAIN_TEMPLATE_RENDER_FAILED:${basename(destination)}`,
      { cause: error },
    )
  }
  return destination
}

export function parseCreateDomainArguments(
  arguments_: string[],
): { id: string; displayName: string } {
  const idIndex = arguments_.indexOf('--id')
  const nameIndex = arguments_.indexOf('--name')
  const id = idIndex >= 0 ? arguments_[idIndex + 1] : undefined
  const displayName = nameIndex >= 0 ? arguments_[nameIndex + 1] : undefined
  if (!id || !displayName) {
    throw new Error(
      'Usage: pnpm domain:create -- --id <domain-id> --name "<name>"',
    )
  }
  return {
    id: domainIdSchema.parse(id),
    displayName: displayNameSchema.parse(displayName)
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const output = await createDomainPack(
      parseCreateDomainArguments(process.argv.slice(2)),
    )
    process.stdout.write(`${output}\n`)
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    )
    process.exitCode = 1
  }
}
