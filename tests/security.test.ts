import {
  constantTimeTokenEquals,
  createPublicTaskId,
  randomUrlToken,
  sha256Label
} from '../src/crypto.js'
import {
  assertSafeProvenanceUrl,
  isBlockedAddress
} from '../src/security/url-policy.js'
import { isTrustedProxy } from '../src/http/security.js'

describe('security primitives', () => {
  it('creates non-enumerable public identifiers and hashes', () => {
    const first = createPublicTaskId()
    const second = createPublicTaskId()
    expect(first).toMatch(/^ekt_[A-Za-z0-9_-]{32}$/)
    expect(second).not.toBe(first)
    expect(randomUrlToken(32)).toHaveLength(43)
    expect(sha256Label('fact')).toMatch(/^sha256:[0-9a-f]{64}$/)
  })

  it('compares bearer tokens without plaintext equality', () => {
    expect(constantTimeTokenEquals('same-token', 'same-token')).toBe(true)
    expect(constantTimeTokenEquals('first-token', 'second-token')).toBe(false)
  })

  it('blocks private and reserved provenance destinations', async () => {
    for (const address of [
      '127.0.0.1',
      '10.0.0.1',
      '169.254.169.254',
      '192.168.1.1',
      '::1',
      'fd00::1'
    ]) {
      expect(isBlockedAddress(address)).toBe(true)
    }
    await expect(
      assertSafeProvenanceUrl('https://127.0.0.1/manual'),
    ).rejects.toThrow('UNSAFE_PROVENANCE_URL')
    await expect(
      assertSafeProvenanceUrl('http://example.com/manual'),
    ).rejects.toThrow('UNSAFE_PROVENANCE_URL')
  })

  it('trusts only explicitly configured proxy ranges', () => {
    expect(isTrustedProxy('127.0.0.1', ['127.0.0.1/32'])).toBe(true)
    expect(isTrustedProxy('10.0.0.1', ['127.0.0.1/32'])).toBe(false)
  })
})
