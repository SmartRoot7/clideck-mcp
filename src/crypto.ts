import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual
} from 'node:crypto'

export function sha256(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest()
}

export function sha256Label(value: string): string {
  return `sha256:${createHash('sha256').update(value, 'utf8').digest('hex')}`
}

export function randomUrlToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url')
}

export function deriveUrlToken(value: string, key: string): string {
  return createHmac('sha256', key)
    .update(value, 'utf8')
    .digest('base64url')
}

export function createPublicTaskId(): string {
  return `ekt_${randomUrlToken(24)}`
}

export function signPayload(
  value: Record<string, unknown>,
  key: string,
): string {
  const encoded = Buffer.from(JSON.stringify(value), 'utf8').toString('base64url')
  const signature = createHmac('sha256', key)
    .update(encoded, 'utf8')
    .digest('base64url')
  return `${encoded}.${signature}`
}

export function verifySignedPayload(
  token: string,
  key: string,
): Record<string, unknown> {
  const [encoded, suppliedSignature, extra] = token.split('.')
  if (!encoded || !suppliedSignature || extra) {
    throw new Error('VERIFICATION_TOKEN_INVALID')
  }
  const expectedSignature = createHmac('sha256', key)
    .update(encoded, 'utf8')
    .digest('base64url')
  if (!constantTimeTokenEquals(suppliedSignature, expectedSignature)) {
    throw new Error('VERIFICATION_TOKEN_INVALID')
  }
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(encoded, 'base64url').toString('utf8'),
    )
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('invalid payload')
    }
    return parsed as Record<string, unknown>
  } catch {
    throw new Error('VERIFICATION_TOKEN_INVALID')
  }
}

export function constantTimeTokenEquals(
  candidate: string,
  expected: string,
): boolean {
  const candidateHash = sha256(candidate)
  const expectedHash = sha256(expected)
  return timingSafeEqual(candidateHash, expectedHash)
}
