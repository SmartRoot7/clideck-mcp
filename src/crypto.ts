import {
  createHash,
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

export function createPublicTaskId(): string {
  return `ekt_${randomUrlToken(24)}`
}

export function constantTimeTokenEquals(
  candidate: string,
  expected: string,
): boolean {
  const candidateHash = sha256(candidate)
  const expectedHash = sha256(expected)
  return timingSafeEqual(candidateHash, expectedHash)
}
