import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

async function probeManager(): Promise<void> {
  await execFileAsync('/bin/launchctl', ['managerpid'], {
    timeout: 5_000,
    maxBuffer: 4_096,
    encoding: 'utf8'
  })
}

export async function hasInvalidLaunchdBootstrap(input: {
  platform?: NodeJS.Platform
  probe?: () => Promise<void>
} = {}): Promise<boolean> {
  if ((input.platform ?? process.platform) !== 'darwin') return false
  const probe = input.probe ?? probeManager
  const invalid = async (): Promise<boolean> => {
    try {
      await probe()
      return false
    } catch (error) {
      if (!error || typeof error !== 'object') return false
      const failure = error as { code?: unknown; stderr?: unknown }
      return failure.code === 153 &&
        typeof failure.stderr === 'string' &&
        failure.stderr.trim() === 'Could not get manager PID.'
    }
  }
  // Confirm the observed invalid Mach bootstrap; other probe failures do not
  // justify recycling a healthy executor pool.
  return await invalid() && await invalid()
}
