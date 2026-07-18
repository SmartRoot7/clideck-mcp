import { execFile } from 'node:child_process'
import { access } from 'node:fs/promises'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const action = process.argv[2]
const label = 'com.clideck.mcp.pipeline'
const domain = `gui/${process.getuid?.() ?? 0}`
const service = `${domain}/${label}`
const plist = resolve(
  homedir(),
  'Library',
  'LaunchAgents',
  `${label}.plist`,
)

if (!['start', 'stop', 'status'].includes(action ?? '')) {
  throw new Error('Action must be start, stop, or status.')
}

if (action === 'stop') {
  await execFileAsync('launchctl', ['disable', service])
  await execFileAsync('launchctl', ['bootout', service])
    .catch(() => undefined)
  process.stdout.write('CliDeck MCP Luna pool stopped.\n')
} else if (action === 'start') {
  await access(plist)
  await execFileAsync('launchctl', ['bootout', service])
    .catch(() => undefined)
  await execFileAsync('launchctl', ['enable', service])
  await execFileAsync('launchctl', ['bootstrap', domain, plist])
  await execFileAsync('launchctl', ['kickstart', '-k', service])
  process.stdout.write('CliDeck MCP Luna pool started.\n')
} else {
  const result = await execFileAsync('launchctl', ['print', service])
  process.stdout.write(result.stdout)
}
