import {
  createHash,
  createHmac,
  timingSafeEqual
} from 'node:crypto'

import type { MiddlewareHandler } from 'hono'
import { createMiddleware } from 'hono/factory'

export type AdminActorRole = 'admin' | 'super_admin'

export type AdminActor = {
  id: string
  role: AdminActorRole
}

export type AdminActorBindings = {
  Variables: {
    adminActor: AdminActor
  }
}

type VerifyAdminActorInput = {
  headers: Headers
  method: string
  pathWithQuery: string
  body: string
  secret: string
  nowSeconds: number
  maxClockSkewSeconds?: number
}

type VerifyAdminActorResult =
  | { valid: true; actor: AdminActor; nonce: string; expiresAt: number }
  | { valid: false }

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const NONCE_PATTERN = /^[0-9a-f]{32}$/i
const SIGNATURE_PATTERN = /^v1=([0-9a-f]{64})$/i
const DEFAULT_CLOCK_SKEW_SECONDS = 120

function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

export function createAdminActorSignature(input: {
  secret: string
  timestamp: string
  nonce: string
  method: string
  pathWithQuery: string
  body: string
  actorId: string
  role: AdminActorRole
}): string {
  const canonical = [
    'v1',
    input.timestamp,
    input.nonce,
    input.method,
    input.pathWithQuery,
    sha256Hex(input.body),
    input.actorId,
    input.role
  ].join('\n')
  return `v1=${createHmac('sha256', input.secret)
    .update(canonical, 'utf8')
    .digest('hex')}`
}

function signaturesEqual(candidate: string, expected: string): boolean {
  const candidateMatch = SIGNATURE_PATTERN.exec(candidate)
  const expectedMatch = SIGNATURE_PATTERN.exec(expected)
  if (!candidateMatch?.[1] || !expectedMatch?.[1]) return false
  return timingSafeEqual(
    Buffer.from(candidateMatch[1], 'hex'),
    Buffer.from(expectedMatch[1], 'hex')
  )
}

export function verifyAdminActorSignature(
  input: VerifyAdminActorInput
): VerifyAdminActorResult {
  const actorId = input.headers.get('x-clideck-admin-actor') ?? ''
  const role = input.headers.get('x-clideck-admin-role') ?? ''
  const timestampText =
    input.headers.get('x-clideck-admin-timestamp') ?? ''
  const nonce = input.headers.get('x-clideck-admin-nonce') ?? ''
  const suppliedSignature =
    input.headers.get('x-clideck-admin-signature') ?? ''

  if (
    !UUID_PATTERN.test(actorId) ||
    (role !== 'admin' && role !== 'super_admin') ||
    !/^[0-9]{10}$/.test(timestampText) ||
    !NONCE_PATTERN.test(nonce) ||
    !SIGNATURE_PATTERN.test(suppliedSignature)
  ) {
    return { valid: false }
  }

  const timestamp = Number(timestampText)
  const maxClockSkew =
    input.maxClockSkewSeconds ?? DEFAULT_CLOCK_SKEW_SECONDS
  if (
    !Number.isSafeInteger(timestamp) ||
    Math.abs(input.nowSeconds - timestamp) > maxClockSkew
  ) {
    return { valid: false }
  }

  const expectedSignature = createAdminActorSignature({
    secret: input.secret,
    timestamp: timestampText,
    nonce,
    method: input.method,
    pathWithQuery: input.pathWithQuery,
    body: input.body,
    actorId,
    role
  })
  if (!signaturesEqual(suppliedSignature, expectedSignature)) {
    return { valid: false }
  }

  return {
    valid: true,
    actor: { id: actorId, role },
    nonce,
    expiresAt: timestamp + maxClockSkew
  }
}

export class AdminNonceReplayGuard {
  readonly #entries = new Map<string, number>()

  constructor(private readonly maxEntries = 10_000) {}

  consume(nonce: string, expiresAt: number, nowSeconds: number): boolean {
    for (const [existingNonce, existingExpiry] of this.#entries) {
      if (existingExpiry < nowSeconds) this.#entries.delete(existingNonce)
    }
    if (this.#entries.has(nonce)) return false

    while (this.#entries.size >= this.maxEntries) {
      const oldest = this.#entries.keys().next().value as string | undefined
      if (!oldest) break
      this.#entries.delete(oldest)
    }
    this.#entries.set(nonce, expiresAt)
    return true
  }
}

export function requireSignedAdminActor(
  secret: string,
  replayGuard = new AdminNonceReplayGuard(),
  now: () => number = () => Math.floor(Date.now() / 1000)
): MiddlewareHandler<AdminActorBindings> {
  return createMiddleware<AdminActorBindings>(async (context, next) => {
    const method = context.req.method.toUpperCase()
    if (method !== 'GET' && method !== 'POST') {
      return context.json({ error: 'invalid_admin_signature' }, 401)
    }

    let body = ''
    try {
      if (method === 'POST') {
        body = await context.req.raw.clone().text()
      }
    } catch {
      return context.json({ error: 'invalid_admin_signature' }, 401)
    }

    const requestUrl = new URL(context.req.url)
    const result = verifyAdminActorSignature({
      headers: context.req.raw.headers,
      method,
      pathWithQuery: `${requestUrl.pathname}${requestUrl.search}`,
      body,
      secret,
      nowSeconds: now()
    })
    if (
      !result.valid ||
      !replayGuard.consume(result.nonce, result.expiresAt, now())
    ) {
      return context.json({ error: 'invalid_admin_signature' }, 401)
    }

    context.set('adminActor', result.actor)
    await next()
  })
}
