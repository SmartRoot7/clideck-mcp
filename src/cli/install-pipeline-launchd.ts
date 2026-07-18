import { execFile } from 'node:child_process'
import { access, copyFile, mkdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const label = 'com.clideck.mcp.pipeline'
const projectRoot = process.cwd()
const destination = resolve(
  homedir(),
  'Library',
  'LaunchAgents',
  `${label}.plist`,
)

function xml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

const pnpm = (await execFileAsync('/usr/bin/which', ['pnpm'])).stdout.trim()
if (!pnpm.startsWith('/')) throw new Error('PNPM_BINARY_NOT_FOUND')
await access(resolve(projectRoot, '.secrets/researcher-bridge.env'))
await mkdir(dirname(destination), { recursive: true, mode: 0o755 })

try {
  await access(destination)
  const backup = `${destination}.backup-${new Date()
    .toISOString()
    .replaceAll(/[:.]/g, '-')}`
  await copyFile(destination, backup)
} catch {
  // No previous launch agent exists.
}

const command = [
  'exec',
  `'${pnpm.replaceAll("'", "'\\''")}'`,
  '--dir',
  `'${projectRoot.replaceAll("'", "'\\''")}'`,
  'pipeline:coordinator'
].join(' ')
const errorLog = resolve(projectRoot, 'tmp/pipeline-coordinator.err.log')
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
await writeFile(destination, plist, { encoding: 'utf8', mode: 0o600 })
await mkdir(dirname(errorLog), { recursive: true, mode: 0o750 })

const domain = `gui/${process.getuid?.() ?? 0}`
await execFileAsync('launchctl', ['bootout', domain, destination])
  .catch(() => undefined)
await execFileAsync('launchctl', ['bootstrap', domain, destination])
await execFileAsync('launchctl', ['enable', `${domain}/${label}`])
await execFileAsync('launchctl', ['kickstart', '-k', `${domain}/${label}`])
process.stdout.write(`Installed and started ${label}\n`)
