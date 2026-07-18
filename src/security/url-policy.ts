import { lookup as lookupCallback } from 'node:dns'
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import type { LookupFunction } from 'node:net'

function isBlockedIpv4(address: string): boolean {
  const octets = address.split('.').map(Number)
  const first = octets[0] ?? -1
  const second = octets[1] ?? -1
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 0) ||
    (first === 192 && second === 168) ||
    (first === 198 && (second === 18 || second === 19)) ||
    first >= 224
  )
}

function isBlockedIpv6(address: string): boolean {
  const normalized = address.toLowerCase()
  return (
    normalized === '::' ||
    normalized === '::1' ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    /^fe[89ab]/.test(normalized) ||
    normalized.startsWith('2001:db8:')
  )
}

export function isBlockedAddress(address: string): boolean {
  const family = isIP(address)
  if (family === 4) return isBlockedIpv4(address)
  if (family === 6) return isBlockedIpv6(address)
  return true
}

export const safePublicLookup: LookupFunction = (
  hostname,
  options,
  callback,
) => {
  lookupCallback(
    hostname,
    {
      family: options.family,
      hints: options.hints,
      all: true,
      order: 'verbatim'
    },
    (error, addresses) => {
      if (error) {
        callback(error, '', 0)
        return
      }
      if (
        addresses.length === 0 ||
        addresses.some((address) => isBlockedAddress(address.address))
      ) {
        const blocked = Object.assign(
          new Error('UNSAFE_PROVENANCE_URL'),
          { code: 'EACCES' },
        )
        callback(blocked, '', 0)
        return
      }
      if (options.all) {
        callback(null, addresses)
        return
      }
      const selected = addresses[0]!
      callback(null, selected.address, selected.family)
    },
  )
}

export async function assertSafeProvenanceUrl(value: string): Promise<void> {
  const url = new URL(value)
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    (url.port && url.port !== '443') ||
    url.hostname.length > 253 ||
    url.hostname === 'localhost' ||
    url.hostname.endsWith('.local') ||
    url.hostname.endsWith('.lan') ||
    url.hostname.endsWith('.internal')
  ) {
    throw new Error('UNSAFE_PROVENANCE_URL')
  }

  if (isIP(url.hostname)) {
    if (isBlockedAddress(url.hostname)) {
      throw new Error('UNSAFE_PROVENANCE_URL')
    }
    return
  }

  const addresses = await lookup(url.hostname, { all: true, verbatim: true })
  if (
    addresses.length === 0 ||
    addresses.some((address) => isBlockedAddress(address.address))
  ) {
    throw new Error('UNSAFE_PROVENANCE_URL')
  }
}
