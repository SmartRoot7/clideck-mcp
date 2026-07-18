import {
  createHmac,
  randomBytes,
  scrypt as nodeScrypt,
  timingSafeEqual
} from 'node:crypto'

const PASSWORD_HASH_PREFIX = 'scrypt-v1'
const DERIVED_KEY_BYTES = 64

function scrypt(
  password: string,
  salt: Uint8Array,
  keyLength: number,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    nodeScrypt(password, salt, keyLength, (error, derivedKey) => {
      if (error) reject(error)
      else resolve(derivedKey)
    })
  })
}

export type LocalAdminActor = {
  id: string
  username: string
  role: 'super_admin'
}

type SessionRecord = {
  actor: LocalAdminActor
  expiresAt: number
}

function encode(value: Uint8Array): string {
  return Buffer.from(value).toString('base64url')
}

function decode(value: string): Buffer | null {
  try {
    return Buffer.from(value, 'base64url')
  } catch {
    return null
  }
}

export async function hashAdminPassword(password: string): Promise<string> {
  const salt = randomBytes(24)
  const derived = await scrypt(password, salt, DERIVED_KEY_BYTES)
  return `${PASSWORD_HASH_PREFIX}$${encode(salt)}$${encode(derived)}`
}

export async function verifyAdminPassword(
  password: string,
  encodedHash: string,
): Promise<boolean> {
  const [prefix, encodedSalt, encodedDerived, extra] = encodedHash.split('$')
  if (
    prefix !== PASSWORD_HASH_PREFIX ||
    !encodedSalt ||
    !encodedDerived ||
    extra !== undefined
  ) {
    return false
  }
  const salt = decode(encodedSalt)
  const expected = decode(encodedDerived)
  if (!salt || !expected || salt.length < 16 || expected.length !== DERIVED_KEY_BYTES) {
    return false
  }
  const actual = await scrypt(password, salt, DERIVED_KEY_BYTES)
  return timingSafeEqual(actual, expected)
}

export class LocalAdminSessionStore {
  readonly #sessions = new Map<string, SessionRecord>()

  constructor(
    private readonly secret: string,
    private readonly lifetimeMs: number,
    private readonly maxSessions = 8,
  ) {}

  #key(token: string): string {
    return createHmac('sha256', this.secret).update(token).digest('hex')
  }

  #prune(now = Date.now()): void {
    for (const [key, session] of this.#sessions) {
      if (session.expiresAt <= now) this.#sessions.delete(key)
    }
    while (this.#sessions.size >= this.maxSessions) {
      const oldest = this.#sessions.keys().next().value as string | undefined
      if (!oldest) break
      this.#sessions.delete(oldest)
    }
  }

  create(actor: LocalAdminActor, now = Date.now()): {
    token: string
    expiresAt: number
  } {
    this.#prune(now)
    const token = randomBytes(32).toString('base64url')
    const expiresAt = now + this.lifetimeMs
    this.#sessions.set(this.#key(token), { actor, expiresAt })
    return { token, expiresAt }
  }

  get(token: string | undefined, now = Date.now()): SessionRecord | null {
    if (!token || token.length > 256) return null
    this.#prune(now)
    return this.#sessions.get(this.#key(token)) ?? null
  }

  revoke(token: string | undefined): void {
    if (!token || token.length > 256) return
    this.#sessions.delete(this.#key(token))
  }
}

export class LoginAttemptGuard {
  readonly #failures: number[] = []

  constructor(
    private readonly maximumFailures = 5,
    private readonly windowMs = 15 * 60_000,
  ) {}

  #prune(now: number): void {
    const minimum = now - this.windowMs
    while (this.#failures[0] !== undefined && this.#failures[0] < minimum) {
      this.#failures.shift()
    }
  }

  allowed(now = Date.now()): boolean {
    this.#prune(now)
    return this.#failures.length < this.maximumFailures
  }

  recordFailure(now = Date.now()): void {
    this.#prune(now)
    this.#failures.push(now)
  }

  reset(): void {
    this.#failures.length = 0
  }
}
