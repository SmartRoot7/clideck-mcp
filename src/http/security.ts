import { isIP } from 'node:net'

import { getConnInfo } from '@hono/node-server/conninfo'
import type { Context, MiddlewareHandler } from 'hono'
import { createMiddleware } from 'hono/factory'

import type { AppConfig } from '../config.js'
import { constantTimeTokenEquals, sha256 } from '../crypto.js'
import type { Database } from '../db.js'

function ipv4ToNumber(address: string): number | null {
  const parts = address.split('.').map(Number)
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return null
  }
  return (
    (((parts[0]! << 24) >>> 0) +
      (parts[1]! << 16) +
      (parts[2]! << 8) +
      parts[3]!) >>>
    0
  )
}

function isIpv4InCidr(address: string, cidr: string): boolean {
  const [network, prefixText] = cidr.split('/')
  if (!network || !prefixText || isIP(network) !== 4 || isIP(address) !== 4) {
    return false
  }
  const prefix = Number.parseInt(prefixText, 10)
  if (prefix < 0 || prefix > 32) return false
  const addressNumber = ipv4ToNumber(address)
  const networkNumber = ipv4ToNumber(network)
  if (addressNumber === null || networkNumber === null) return false
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0
  return (addressNumber & mask) === (networkNumber & mask)
}

export function isTrustedProxy(
  remoteAddress: string,
  cidrs: readonly string[],
): boolean {
  const normalized =
    remoteAddress.startsWith('::ffff:')
      ? remoteAddress.slice('::ffff:'.length)
      : remoteAddress

  return cidrs.some((cidr) => {
    if (cidr === '::1/128') return normalized === '::1'
    if (cidr === '127.0.0.1/32') return normalized === '127.0.0.1'
    return isIpv4InCidr(normalized, cidr)
  })
}

export function getClientAddress(
  context: Context,
  config: AppConfig,
): string {
  const remoteAddress = getConnInfo(context).remote.address ?? 'unknown'
  if (!isTrustedProxy(remoteAddress, config.trustedProxyCidrs)) {
    return remoteAddress
  }

  const cloudflareAddress = context.req.header('cf-connecting-ip')
  if (cloudflareAddress && isIP(cloudflareAddress)) return cloudflareAddress

  const forwarded = context.req.header('x-forwarded-for')?.split(',')[0]?.trim()
  if (forwarded && isIP(forwarded)) return forwarded
  return remoteAddress
}

export function requestPolicy(config: AppConfig): MiddlewareHandler {
  const publicUrl = new URL(config.publicBaseUrl)
  const allowedHosts = new Set([
    publicUrl.host.toLowerCase(),
    `${config.api.host}:${config.api.port}`.toLowerCase(),
    `127.0.0.1:${config.api.port}`,
    `localhost:${config.api.port}`
  ])

  return createMiddleware(async (context, next) => {
    const host = context.req.header('host')?.toLowerCase()
    if (config.nodeEnv === 'production' && (!host || !allowedHosts.has(host))) {
      return context.json({ error: 'invalid_host' }, 421)
    }

    const origin = context.req.header('origin')
    if (origin && origin !== publicUrl.origin) {
      return context.json({ error: 'invalid_origin' }, 403)
    }

    await next()
  })
}

export function requireStaticBearer(expectedToken: string): MiddlewareHandler {
  return createMiddleware(async (context, next) => {
    const authorization = context.req.header('authorization')
    const token = authorization?.startsWith('Bearer ')
      ? authorization.slice('Bearer '.length)
      : ''

    if (!token || !constantTimeTokenEquals(token, expectedToken)) {
      context.header('WWW-Authenticate', 'Bearer')
      return context.json({ error: 'unauthorized' }, 401)
    }
    await next()
  })
}

export async function consumeRateLimit(
  database: Database,
  clientKey: string,
  routeClass: string,
  limit: number,
): Promise<{ allowed: boolean; remaining: number }> {
  const result = await database.query<{ request_count: number }>(
    `INSERT INTO rate_limit_buckets (
       bucket_key, route_class, window_start, request_count
     )
     VALUES ($1, $2, date_trunc('minute', now()), 1)
     ON CONFLICT (bucket_key, route_class, window_start)
     DO UPDATE SET request_count = rate_limit_buckets.request_count + 1
     RETURNING request_count`,
    [sha256(clientKey), routeClass],
  )
  const count = result.rows[0]?.request_count ?? limit + 1
  return {
    allowed: count <= limit,
    remaining: Math.max(0, limit - count)
  }
}
