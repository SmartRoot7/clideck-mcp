import { lookup as lookupCallback } from 'node:dns'
import { lookup } from 'node:dns/promises'
import { request as httpsRequest } from 'node:https'
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
  const mappedIpv4 = embeddedIpv4Address(normalized)
  if (mappedIpv4) return isBlockedIpv4(mappedIpv4)
  return (
    normalized === '::' ||
    normalized === '::1' ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    normalized.startsWith('fe') ||
    normalized.startsWith('ff') ||
    normalized.startsWith('64:ff9b:') ||
    normalized.startsWith('100:') ||
    normalized.startsWith('2001:0:') ||
    normalized.startsWith('2001:2:') ||
    normalized.startsWith('2001:db8:')
  )
}

function embeddedIpv4Address(address: string): string | null {
  const withoutZone = address.split('%', 1)[0] ?? address
  const halves = withoutZone.split('::')
  if (halves.length > 2) return null

  const parseHalf = (value: string): number[] | null => {
    if (!value) return []
    const parts = value.split(':')
    const words: number[] = []
    for (const [index, part] of parts.entries()) {
      if (part.includes('.')) {
        if (index !== parts.length - 1 || !isBlockedIpv4Candidate(part)) {
          return null
        }
        const octets = part.split('.').map(Number)
        words.push(
          ((octets[0] ?? 0) << 8) | (octets[1] ?? 0),
          ((octets[2] ?? 0) << 8) | (octets[3] ?? 0),
        )
        continue
      }
      if (!/^[0-9a-f]{1,4}$/i.test(part)) return null
      words.push(Number.parseInt(part, 16))
    }
    return words
  }

  const left = parseHalf(halves[0] ?? '')
  const right = parseHalf(halves[1] ?? '')
  if (!left || !right) return null
  const omitted = halves.length === 2 ? 8 - left.length - right.length : 0
  if (
    omitted < 0 ||
    (halves.length === 1 && left.length !== 8) ||
    (halves.length === 2 && omitted < 1)
  ) {
    return null
  }
  const words = [...left, ...Array<number>(omitted).fill(0), ...right]
  if (words.length !== 8 || words.slice(0, 5).some((word) => word !== 0)) {
    return null
  }
  if (words[5] !== 0 && words[5] !== 0xffff) return null
  const high = words[6] ?? 0
  const low = words[7] ?? 0
  return [
    high >>> 8,
    high & 0xff,
    low >>> 8,
    low & 0xff
  ].join('.')
}

function isBlockedIpv4Candidate(address: string): boolean {
  if (isIP(address) !== 4) return false
  return address.split('.').every((octet) => {
    const value = Number(octet)
    return Number.isInteger(value) && value >= 0 && value <= 255
  })
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

export function assertSafePublicSourceUrlSyntax(value: string): void {
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
  }
}

export async function assertSafeProvenanceUrl(value: string): Promise<void> {
  assertSafePublicSourceUrlSyntax(value)
  const url = new URL(value)
  if (isIP(url.hostname)) return

  const addresses = await lookup(url.hostname, { all: true, verbatim: true })
  if (
    addresses.length === 0 ||
    addresses.some((address) => isBlockedAddress(address.address))
  ) {
    throw new Error('UNSAFE_PROVENANCE_URL')
  }
}

const publicSourceMediaTypes = new Set([
  'application/pdf',
  'application/xhtml+xml',
  'text/html',
  'text/plain'
])

export type PublicSourceProbe =
  | { ok: true; finalUrl: string; mediaType: string }
  | { ok: false; code: string; retryable: boolean }

export async function probePublicSourceUrl(
  initialUrl: string,
  timeoutMs = 5_000,
): Promise<PublicSourceProbe> {
  let currentUrl = initialUrl
  try {
    for (let redirects = 0; redirects <= 5; redirects += 1) {
      assertSafePublicSourceUrlSyntax(currentUrl)
      const response = await new Promise<{
        status: number
        headers: NodeJS.Dict<string | string[]>
      }>((resolvePromise, rejectPromise) => {
        const request = httpsRequest(
          currentUrl,
          {
            method: 'GET',
            agent: false,
            lookup: safePublicLookup,
            signal: AbortSignal.timeout(timeoutMs),
            headers: {
              accept:
                'application/pdf,text/html,application/xhtml+xml,text/plain;q=0.9',
              range: 'bytes=0-1023',
              'user-agent': 'CliDeck-MCP-Source-Preflight/0.8'
            }
          },
          (incoming) => {
            resolvePromise({
              status: incoming.statusCode ?? 0,
              headers: incoming.headers
            })
            incoming.destroy()
          },
        )
        request.once('error', rejectPromise)
        request.end()
      })
      if (response.status >= 300 && response.status < 400) {
        const rawLocation = response.headers['location']
        const location = Array.isArray(rawLocation)
          ? rawLocation[0]
          : rawLocation
        if (!location || redirects === 5) {
          return { ok: false, code: 'SOURCE_REDIRECT_INVALID', retryable: false }
        }
        currentUrl = new URL(location, currentUrl).toString()
        continue
      }
      if (response.status !== 200 && response.status !== 206) {
        return {
          ok: false,
          code: `SOURCE_HTTP_${response.status}`,
          retryable:
            response.status === 403 ||
            response.status === 408 ||
            response.status === 429 ||
            response.status >= 500
        }
      }
      const rawContentType = response.headers['content-type']
      const contentType = Array.isArray(rawContentType)
        ? rawContentType[0]
        : rawContentType
      const mediaType = (contentType ?? '')
        .split(';')[0]!.trim().toLowerCase()
      if (!publicSourceMediaTypes.has(mediaType)) {
        return { ok: false, code: 'SOURCE_MIME_NOT_ALLOWED', retryable: false }
      }
      const final = new URL(currentUrl)
      final.hash = ''
      return { ok: true, finalUrl: final.toString(), mediaType }
    }
  } catch (error) {
    const code = error instanceof Error && error.message === 'UNSAFE_PROVENANCE_URL'
      ? 'UNSAFE_PROVENANCE_URL'
      : 'SOURCE_PREFLIGHT_UNAVAILABLE'
    return {
      ok: false,
      code,
      retryable: code !== 'UNSAFE_PROVENANCE_URL'
    }
  }
  return { ok: false, code: 'SOURCE_REDIRECT_INVALID', retryable: false }
}
