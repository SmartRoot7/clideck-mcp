import { randomBytes, randomUUID } from 'node:crypto'
import { chmod, mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

import { hashAdminPassword } from '../http/admin-ui-auth.js'

function parseOutputPath(): string {
  const index = process.argv.indexOf('--output')
  const candidate = index >= 0 ? process.argv[index + 1] : undefined
  return resolve(candidate ?? '/etc/clideck-mcp/admin-ui.env')
}

async function readHidden(prompt: string): Promise<string> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    const chunks: Buffer[] = []
    for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk))
    return Buffer.concat(chunks).toString('utf8').trimEnd()
  }

  process.stdout.write(prompt)
  process.stdin.setRawMode(true)
  process.stdin.resume()
  process.stdin.setEncoding('utf8')
  let value = ''
  return await new Promise<string>((resolvePassword, reject) => {
    const onData = (character: string) => {
      if (character === '\u0003') {
        cleanup()
        reject(new Error('Admin setup cancelled.'))
        return
      }
      if (character === '\r' || character === '\n') {
        cleanup()
        process.stdout.write('\n')
        resolvePassword(value)
        return
      }
      if (character === '\u007f') {
        if (value.length > 0) {
          value = value.slice(0, -1)
          process.stdout.write('\b \b')
        }
        return
      }
      if (character >= ' ') {
        value += character
        process.stdout.write('•')
      }
    }
    const cleanup = () => {
      process.stdin.off('data', onData)
      process.stdin.setRawMode(false)
      process.stdin.pause()
    }
    process.stdin.on('data', onData)
  })
}

const outputPath = parseOutputPath()
const username = process.env['ADMIN_UI_USERNAME']?.trim() || 'admin'
const firstPassword = await readHidden('Admin password: ')
if (firstPassword.length < 14) {
  throw new Error('Admin password must contain at least 14 characters.')
}
if (process.stdin.isTTY) {
  const confirmation = await readHidden('Repeat password: ')
  if (firstPassword !== confirmation) throw new Error('Passwords do not match.')
}

const passwordHash = await hashAdminPassword(firstPassword)
const sessionSecret = randomBytes(48).toString('base64url')
const actorId = randomUUID()
const contents = [
  'ADMIN_UI_HOST=127.0.0.1',
  'ADMIN_UI_PORT=8790',
  `ADMIN_UI_USERNAME=${username}`,
  `ADMIN_UI_PASSWORD_HASH=${passwordHash}`,
  `ADMIN_UI_SESSION_SECRET=${sessionSecret}`,
  `ADMIN_UI_ACTOR_ID=${actorId}`,
  'ADMIN_UI_ALLOWED_ORIGINS=https://clideck-mcp.lan',
  'ADMIN_UI_SESSION_HOURS=12',
  'ADMIN_UI_ASSET_ROOT=./dist-admin',
  ''
].join('\n')

await mkdir(dirname(outputPath), { recursive: true, mode: 0o750 })
await writeFile(outputPath, contents, { encoding: 'utf8', mode: 0o600 })
await chmod(outputPath, 0o600)
process.stdout.write(`Local admin configuration written to ${outputPath}\n`)
