import { execFile } from 'node:child_process'
import {
  access,
  copyFile,
  mkdir,
  readFile,
  writeFile
} from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, resolve } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const label = 'com.clideck.mcp.pipeline'
const tunnelLabel = 'com.clideck.mcp.pipeline-tunnel'
const projectRoot = process.cwd()
const launchAgentsDirectory = resolve(homedir(), 'Library', 'LaunchAgents')
const destination = resolve(
  launchAgentsDirectory,
  `${label}.plist`,
)
const tunnelDestination = resolve(
  launchAgentsDirectory,
  `${tunnelLabel}.plist`,
)
const secretEnvPath = resolve(
  projectRoot,
  '.secrets',
  'researcher-bridge.env',
)
const errorLog = resolve(projectRoot, 'tmp/pipeline-coordinator.err.log')
const tunnelErrorLog = resolve(projectRoot, 'tmp/pipeline-tunnel.err.log')

function xml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

function parseEnvironmentFile(contents: string): Map<string, string> {
  const values = new Map<string, string>()
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const separator = line.indexOf('=')
    if (separator <= 0) continue
    values.set(line.slice(0, separator).trim(), line.slice(separator + 1).trim())
  }
  return values
}

function requireEnvironmentValue(
  environment: Map<string, string>,
  key: string,
): string {
  const value = environment.get(key)
  if (!value) throw new Error(`${key} is required in researcher-bridge.env`)
  return value
}

async function backupIfPresent(path: string): Promise<void> {
  try {
    await access(path)
    const backup = `${path}.backup-${new Date()
      .toISOString()
      .replaceAll(/[:.]/g, '-')}`
    await copyFile(path, backup)
  } catch {
    // No previous launch agent exists.
  }
}

async function replaceLaunchAgent(
  domain: string,
  path: string,
  serviceLabel: string,
): Promise<void> {
  await execFileAsync('launchctl', ['bootout', domain, path])
    .catch(() => undefined)
  await execFileAsync('launchctl', ['bootstrap', domain, path])
  await execFileAsync('launchctl', [
    'enable',
    `${domain}/${serviceLabel}`
  ])
  await execFileAsync('launchctl', [
    'kickstart',
    '-k',
    `${domain}/${serviceLabel}`
  ])
}

const legacyTunnelLabel = 'com.clideck.mcp.tunnel'
const pnpm = (await execFileAsync('/usr/bin/which', ['pnpm'])).stdout.trim()
if (!pnpm.startsWith('/')) throw new Error('PNPM_BINARY_NOT_FOUND')
await access(secretEnvPath)
await mkdir(launchAgentsDirectory, { recursive: true, mode: 0o755 })
await mkdir(dirname(errorLog), { recursive: true, mode: 0o750 })

const bridgeEnvironment = parseEnvironmentFile(
  await readFile(secretEnvPath, 'utf8'),
)
const researcherUrl = new URL(
  requireEnvironmentValue(bridgeEnvironment, 'CLIDECK_RESEARCHER_URL'),
)
const sshHost = requireEnvironmentValue(
  bridgeEnvironment,
  'CLIDECK_RESEARCHER_SSH_HOST',
)
const sshUser = requireEnvironmentValue(
  bridgeEnvironment,
  'CLIDECK_RESEARCHER_SSH_USER',
)
const sshIdentity = requireEnvironmentValue(
  bridgeEnvironment,
  'CLIDECK_RESEARCHER_SSH_IDENTITY',
)
const tunnelPort = Number(
  requireEnvironmentValue(
    bridgeEnvironment,
    'CLIDECK_RESEARCHER_TUNNEL_PORT',
  ),
)
if (
  !['127.0.0.1', 'localhost'].includes(researcherUrl.hostname)
  || Number(researcherUrl.port) !== tunnelPort
) {
  throw new Error(
    'CLIDECK_RESEARCHER_URL must use the configured localhost tunnel',
  )
}
if (!/^[A-Za-z0-9_.-]+$/.test(sshHost)) {
  throw new Error('CLIDECK_RESEARCHER_SSH_HOST is invalid')
}
if (!/^[A-Za-z_][A-Za-z0-9_-]{0,31}$/.test(sshUser)) {
  throw new Error('CLIDECK_RESEARCHER_SSH_USER is invalid')
}
if (!isAbsolute(sshIdentity)) {
  throw new Error('CLIDECK_RESEARCHER_SSH_IDENTITY must be absolute')
}
if (!Number.isInteger(tunnelPort) || tunnelPort < 1024 || tunnelPort > 65535) {
  throw new Error('CLIDECK_RESEARCHER_TUNNEL_PORT is invalid')
}
await access(sshIdentity)
const knownHostsPath = resolve(homedir(), '.ssh', 'known_hosts')
await access(knownHostsPath)

const command = [
  'exec',
  `'${pnpm.replaceAll("'", "'\\''")}'`,
  '--dir',
  `'${projectRoot.replaceAll("'", "'\\''")}'`,
  'pipeline:coordinator'
].join(' ')
const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${label}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/zsh</string>
    <string>-lc</string>
    <string>${xml(command)}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${xml(projectRoot)}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>ProcessType</key>
  <string>Background</string>
  <key>StandardOutPath</key>
  <string>/dev/null</string>
  <key>StandardErrorPath</key>
  <string>${xml(errorLog)}</string>
</dict>
</plist>
`
const tunnelPlist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${tunnelLabel}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/ssh</string>
    <string>-N</string>
    <string>-o</string>
    <string>BatchMode=yes</string>
    <string>-o</string>
    <string>ExitOnForwardFailure=yes</string>
    <string>-o</string>
    <string>ServerAliveInterval=30</string>
    <string>-o</string>
    <string>ServerAliveCountMax=3</string>
    <string>-o</string>
    <string>IdentitiesOnly=yes</string>
    <string>-i</string>
    <string>${xml(sshIdentity)}</string>
    <string>-o</string>
    <string>UserKnownHostsFile=${xml(knownHostsPath)}</string>
    <string>-L</string>
    <string>127.0.0.1:${tunnelPort}:${xml(sshHost)}:8788</string>
    <string>${xml(sshUser)}@${xml(sshHost)}</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>ProcessType</key>
  <string>Background</string>
  <key>StandardOutPath</key>
  <string>/dev/null</string>
  <key>StandardErrorPath</key>
  <string>${xml(tunnelErrorLog)}</string>
</dict>
</plist>
`

await backupIfPresent(destination)
await backupIfPresent(tunnelDestination)
await writeFile(destination, plist, { encoding: 'utf8', mode: 0o600 })
await writeFile(tunnelDestination, tunnelPlist, {
  encoding: 'utf8',
  mode: 0o600
})

const domain = `gui/${process.getuid?.() ?? 0}`
await execFileAsync('launchctl', ['bootout', domain, destination])
  .catch(() => undefined)
await execFileAsync('launchctl', ['remove', legacyTunnelLabel])
  .catch(() => undefined)
await replaceLaunchAgent(domain, tunnelDestination, tunnelLabel)
await replaceLaunchAgent(domain, destination, label)
process.stdout.write(
  `Installed and started ${tunnelLabel} and ${label}\n`,
)
