import { execFile } from 'node:child_process'
import { access } from 'node:fs/promises'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const action = process.argv[2]
const label = 'com.clideck.mcp.pipeline'
const service = `gui/${process.getuid?.() ?? 0}/${label}`
const plist = resolve(
  homedir(),
  'Library',
  'LaunchAgents',
  `${label}.plist`,
)

if (!['start', 'stop', 'status'].includes(action ?? '')) {
  throw new Error('Action must be start, stop, or status.')
}

async function isRegistered(): Promise<boolean> {
  try {
    await execFileAsync('launchctl', ['print', service])
    return true
  } catch {
    return false
  }
}

async function waitForRegistration(): Promise<boolean> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (await isRegistered()) return true
    await new Promise<void>((resolve) => setTimeout(resolve, 250))
  }
  return false
}

async function legacyLoad(): Promise<void> {
  // launchctl's per-user legacy entrypoint inherits the interactive Aqua
  // session correctly through zsh on this host, while direct bootstrap has
  // intermittently returned EIO without leaving a durable registration.
  await execFileAsync('/bin/zsh', [
    '-lc',
    'launchctl load -w "$1"',
    'zsh',
    plist,
  ])
}

async function legacyUnload(): Promise<void> {
  await execFileAsync('/bin/zsh', [
    '-lc',
    'launchctl unload -w "$1"',
    'zsh',
    plist,
  ])
}

if (action === 'stop') {
  // The legacy pair is the only restart path that has been reliable in the
  // interactive Aqua session on this host.  `bootout` remains a fallback for
  // a partially registered service, but direct disable/bootstrap is avoided.
  await legacyUnload()
    .catch(() => execFileAsync('launchctl', ['bootout', service]))
    .catch(() => undefined)
  process.stdout.write('CliDeck MCP Luna pool stopped.\n')
} else if (action === 'start') {
  await access(plist)
  if (await isRegistered()) {
    await legacyUnload()
      .catch(() => execFileAsync('launchctl', ['bootout', service]))
      .catch(() => undefined)
  }
  await legacyLoad()
  if (!(await waitForRegistration())) {
    throw new Error('PIPELINE_LAUNCH_AGENT_NOT_REGISTERED')
  }
  process.stdout.write('CliDeck MCP Luna pool started.\n')
} else {
  const result = await execFileAsync('launchctl', ['print', service])
  process.stdout.write(result.stdout)
}
