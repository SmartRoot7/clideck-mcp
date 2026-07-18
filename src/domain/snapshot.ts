import { sha256Label } from '../crypto.js'

export type SnapshotType =
  | 'show_version'
  | 'config'
  | 'log'
  | 'topology'
  | 'other'

type RedactionType =
  | 'secret'
  | 'private_key'
  | 'serial'
  | 'username'
  | 'hostname'
  | 'ip_address'
  | 'mac_address'

type RedactionCount = {
  type: RedactionType
  count: number
}

function replaceAndCount(
  input: string,
  pattern: RegExp,
  replacement: string | ((substring: string, ...args: string[]) => string),
): { value: string; count: number } {
  let count = 0
  return {
    value: input.replace(pattern, (...args: string[]) => {
      count += 1
      return typeof replacement === 'string'
        ? replacement
        : replacement(args[0] ?? '', ...args.slice(1))
    }),
    count
  }
}

export function sanitizeSnapshot(
  snapshot: string,
  profile: 'secrets_only' | 'strict',
): { sanitized: string; redactions: RedactionCount[] } {
  let sanitized = snapshot.replaceAll('\u0000', '')
  const counts = new Map<RedactionType, number>()
  const apply = (
    type: RedactionType,
    pattern: RegExp,
    replacement: string | ((substring: string, ...args: string[]) => string),
  ) => {
    const result = replaceAndCount(sanitized, pattern, replacement)
    sanitized = result.value
    if (result.count > 0) {
      counts.set(type, (counts.get(type) ?? 0) + result.count)
    }
  }

  apply(
    'private_key',
    /-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/gi,
    '[REDACTED_PRIVATE_KEY]',
  )
  apply(
    'secret',
    /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{12,}/gi,
    (_match, scheme) => `${scheme} [REDACTED_SECRET]`,
  )
  apply(
    'secret',
    /(\b(?:password|secret|community|key-string|pre-shared-key|auth-password|tacacs-server key|radius-server key)\b(?:\s+\d+\s+|\s+))([^\s,;]+)/gi,
    (_match, prefix) => `${prefix}[REDACTED_SECRET]`,
  )
  apply(
    'serial',
    /^(\s*(?:system serial number|processor board id|chassis serial number|serial number)\s*:?\s*)(\S+)/gim,
    (_match, prefix) => `${prefix}[REDACTED_SERIAL]`,
  )

  if (profile === 'strict') {
    apply(
      'username',
      /^(\s*username\s+)(\S+)/gim,
      (_match, prefix) => `${prefix}[REDACTED_USERNAME]`,
    )
    apply(
      'hostname',
      /^(\s*hostname\s+)(\S+)/gim,
      (_match, prefix) => `${prefix}[REDACTED_HOSTNAME]`,
    )
    apply(
      'mac_address',
      /\b(?:[0-9a-f]{2}[:-]){5}[0-9a-f]{2}\b|\b[0-9a-f]{4}\.[0-9a-f]{4}\.[0-9a-f]{4}\b/gi,
      '[REDACTED_MAC]',
    )
    apply(
      'ip_address',
      /\b(?:\d{1,3}\.){3}\d{1,3}(?:\/\d{1,2})?\b/g,
      '[REDACTED_IP]',
    )
  }

  return {
    sanitized,
    redactions: [...counts.entries()].map(([type, count]) => ({
      type,
      count
    }))
  }
}

function detectSnapshotType(snapshot: string): SnapshotType {
  if (/Cisco IOS|Junos:|Software image version:|show version/i.test(snapshot)) {
    return 'show_version'
  }
  if (/Device ID:|Local Intf:|System Name:|traceroute to|Routing entry for/i.test(snapshot)) {
    return 'topology'
  }
  if (/^%[A-Z0-9_-]+-\d+-|Traceback|syslog/mi.test(snapshot)) {
    return 'log'
  }
  if (/^(?:hostname|interface|router|ip route|vlan|line |aaa )/mi.test(snapshot)) {
    return 'config'
  }
  return 'other'
}

export type FingerprintedContext = {
  vendor: string
  model: string | null
  operating_system: string
  version: string | null
  support_level: 'deep' | 'recognized'
  confidence: number
  ambiguities: string[]
}

export function fingerprintSnapshot(
  snapshot: string,
): FingerprintedContext | null {
  const cisco =
    /Cisco IOS XE Software|Cisco IOS Software \[?IOSXE\]?|Cisco IOS-XE/i.test(
      snapshot,
    )
  if (cisco) {
    const model =
      snapshot.match(
        /(?:Model [Nn]umber\s*:|cisco\s+)(C9[0-9A-Z-]{3,})(?:\s|\(|$)/i,
      )?.[1]?.toUpperCase() ??
      snapshot.match(/\b(C9300[A-Z0-9-]*)\b/i)?.[1]?.toUpperCase() ??
      null
    const version =
      snapshot.match(/Cisco IOS XE Software,\s*Version\s+([A-Za-z0-9().-]+)/i)
        ?.[1] ??
      snapshot.match(/\bVersion\s+([0-9]+\.[0-9]+(?:\.[A-Za-z0-9]+)?)/i)
        ?.[1] ??
      null
    const deep = Boolean(model?.startsWith('C9300'))
    return {
      vendor: 'Cisco',
      model,
      operating_system: 'Cisco IOS XE',
      version,
      support_level: deep ? 'deep' : 'recognized',
      confidence: model && version ? 0.99 : 0.86,
      ambiguities: [
        ...(model ? [] : ['Device model was not found in the snapshot']),
        ...(version ? [] : ['Software version was not found in the snapshot']),
        ...(deep ? [] : ['Deep knowledge coverage is currently limited to Catalyst 9300'])
      ]
    }
  }

  if (/Junos:|JUNOS Software Release|Juniper Networks/i.test(snapshot)) {
    const model =
      snapshot.match(/^\s*Model:\s*(\S+)/mi)?.[1] ??
      snapshot.match(/\b(?:EX|QFX|MX|SRX)[0-9A-Z-]+\b/i)?.[0] ??
      null
    const version =
      snapshot.match(/^\s*Junos:\s*(\S+)/mi)?.[1] ??
      snapshot.match(/JUNOS Software Release \[([^\]]+)\]/i)?.[1] ??
      null
    return {
      vendor: 'Juniper',
      model,
      operating_system: 'Junos',
      version,
      support_level: 'recognized',
      confidence: model && version ? 0.96 : 0.8,
      ambiguities: ['Junos fingerprinting is available; deep knowledge coverage is limited']
    }
  }

  if (/Arista Networks|Software image version:/i.test(snapshot)) {
    const model =
      snapshot.match(/\b(?:DCS-|CCS-)[A-Z0-9-]+\b/i)?.[0] ??
      snapshot.match(/^\s*Model name:\s*(\S+)/mi)?.[1] ??
      null
    const version =
      snapshot.match(/Software image version:\s*(\S+)/i)?.[1] ?? null
    return {
      vendor: 'Arista',
      model,
      operating_system: 'Arista EOS',
      version,
      support_level: 'recognized',
      confidence: model && version ? 0.96 : 0.8,
      ambiguities: ['EOS fingerprinting is available; deep knowledge coverage is limited']
    }
  }

  return null
}

export function analyzeDeviceSnapshot(input: {
  snapshot: string
  snapshot_type:
    | 'auto'
    | 'show_version'
    | 'config'
    | 'log'
    | 'topology'
    | 'other'
  redaction_profile: 'secrets_only' | 'strict'
}) {
  const context = fingerprintSnapshot(input.snapshot)
  const { sanitized, redactions } = sanitizeSnapshot(
    input.snapshot,
    input.redaction_profile,
  )
  return {
    context,
    snapshot_type:
      input.snapshot_type === 'auto'
        ? detectSnapshotType(input.snapshot)
        : input.snapshot_type,
    sanitized_snapshot: sanitized,
    redactions,
    retention: 'not_stored' as const,
    limitations: [
      'Fingerprinting is deterministic and may not identify modified or truncated banners.',
      `Sanitized snapshot digest: ${sha256Label(sanitized)}`
    ]
  }
}
