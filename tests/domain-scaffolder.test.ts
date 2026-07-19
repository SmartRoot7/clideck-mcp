import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat
} from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import {
  runDomainPackConformance,
  type DomainPack,
  type DomainPackConformanceFixture
} from '@clideck/domain-kit'

import {
  createDomainPack,
  parseCreateDomainArguments,
  renderDomainTemplate
} from '../src/cli/create-domain.js'

describe('domain pack scaffolder', () => {
  it('parses explicit IDs and display names', () => {
    expect(parseCreateDomainArguments([
      '--id',
      'marine-science',
      '--name',
      'Marine Science'
    ])).toEqual({
      id: 'marine-science',
      displayName: 'Marine Science'
    })
    expect(() => parseCreateDomainArguments([])).toThrow('Usage:')
    expect(() => parseCreateDomainArguments([
      '--id',
      '../escape',
      '--name',
      'Escape'
    ])).toThrow()
  })

  it('renders every supported template token', () => {
    expect(renderDomainTemplate(
      '__DOMAIN_ID__ __DISPLAY_NAME__ __DOMAIN_CLASS__',
      { id: 'marine-science', displayName: 'Marine Science' },
    )).toBe('marine-science Marine Science MarineScience')
  })

  it('creates a complete pack only inside the destination root', async () => {
    const taskTemporaryRoot = join(process.cwd(), 'tmp')
    await mkdir(taskTemporaryRoot, { recursive: true })
    const temporaryRoot = await mkdtemp(
      join(taskTemporaryRoot, 'domain-scaffold-'),
    )
    try {
      const destination = await createDomainPack({
        id: 'marine-science',
        displayName: 'Marine Science',
        workspaceRoot: process.cwd(),
        destinationRoot: temporaryRoot
      })
      expect((await stat(join(destination, 'src/pack.ts'))).isFile()).toBe(true)
      expect(await readFile(
        join(destination, 'package.json'),
        'utf8',
      )).toContain('@clideck/domain-marine-science')
      expect(await readFile(
        join(destination, 'src/pack.ts'),
        'utf8',
      )).not.toContain('__DOMAIN_')
      const generated = await import(
        pathToFileURL(join(destination, 'src/index.ts')).href
      ) as {
        domainPack: DomainPack
        conformanceFixture: DomainPackConformanceFixture
      }
      expect(runDomainPackConformance(
        generated.domainPack,
        generated.conformanceFixture,
      ).passed).toBe(true)
      await expect(createDomainPack({
        id: 'marine-science',
        displayName: 'Marine Science',
        workspaceRoot: process.cwd(),
        destinationRoot: temporaryRoot
      })).rejects.toThrow('DOMAIN_DESTINATION_EXISTS')
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true })
    }
  })
})
