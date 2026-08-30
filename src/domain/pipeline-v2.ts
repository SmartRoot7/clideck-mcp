import { createHash } from 'node:crypto'

import { z } from 'zod'

export const sourceKindSchema = z.enum([
  'official_web',
  'admin_web',
  'admin_document',
  'pasted_text',
  'field_log'
])
export type SourceKind = z.infer<typeof sourceKindSchema>

export const fragmentDispositionSchema = z.enum([
  'knowledge_extracted',
  'non_knowledge',
  'continuation_required',
  'targeted_retry'
])
export type FragmentDisposition = z.infer<typeof fragmentDispositionSchema>

export const nonKnowledgeReasonSchema = z.enum([
  'navigation_or_toc',
  'legal_or_copyright',
  'part_inventory',
  'physical_installation',
  'general_safety',
  'other_non_operational'
])
export type NonKnowledgeReason = z.infer<typeof nonKnowledgeReasonSchema>

export type FragmentDispositionResult = {
  disposition: FragmentDisposition
  reason:
    | NonKnowledgeReason
    | 'knowledge_extracted'
    | 'boundary_continuation'
    | 'targeted_retry'
}

const commandSignal = /(?:^|\n)\s*(?:[$#>]\s*)?(?:show|display|configure|config|conf\s+t|interface|router|set|delete|erase|reset|copy|write|install|upgrade|debug|diagnose|ping|traceroute|dir|ls|no\s+)\b/im
const operationalSignal = /\b(?:command|syntax|option|parameter|example|configuration|procedure|workflow|troubleshoot|diagnos|error|failure|output|verification|rollback|recovery|log|session)\b/i

/**
 * Conservative deterministic classification. Technical content always wins;
 * the classifier only marks unmistakable document boilerplate as non-knowledge.
 * Ambiguous text stays available to Extract.
 */
export function classifyFragmentDisposition(
  content: string,
): FragmentDispositionResult | null {
  const normalized = content.replace(/\s+/g, ' ').trim()
  if (!normalized) {
    return { disposition: 'targeted_retry', reason: 'targeted_retry' }
  }
  if (
    /^(?:table of )?contents?\b/i.test(normalized) ||
    (normalized.match(/\.{5,}\s*(?:\d+|[ivxlcdm]+)\b/gi)?.length ?? 0) >= 3
  ) {
    return { disposition: 'non_knowledge', reason: 'navigation_or_toc' }
  }
  if (commandSignal.test(content) || operationalSignal.test(content)) return null
  if (
    /\b(?:copyright|all rights reserved|trademark|legal notice|license agreement)\b/i.test(
      normalized,
    )
  ) {
    return { disposition: 'non_knowledge', reason: 'legal_or_copyright' }
  }
  if (
    /\b(?:part number|product number|sku|ordering information|bill of materials)\b/i.test(
      normalized,
    )
  ) {
    return { disposition: 'non_knowledge', reason: 'part_inventory' }
  }
  if (
    /\b(?:rack mount|mounting bracket|install the chassis|power cord|physical installation)\b/i.test(
      normalized,
    )
  ) {
    return { disposition: 'non_knowledge', reason: 'physical_installation' }
  }
  if (
    /\b(?:important safety instructions|regulatory compliance|electric shock|laser radiation)\b/i.test(
      normalized,
    )
  ) {
    return { disposition: 'non_knowledge', reason: 'general_safety' }
  }
  if (
    /\b(?:about this guide|documentation feedback|contact sales|learn more about our products)\b/i.test(
      normalized,
    )
  ) {
    return { disposition: 'non_knowledge', reason: 'other_non_operational' }
  }
  return null
}

export type EvidenceUnit = {
  id: string
  estimatedTokens: number
  evidenceWindow: string
  errorClass?: string | null
}

export function batchEvidenceUnits(
  units: readonly EvidenceUnit[],
  options: { maximumRecords: number; targetTokens: number; hardTokens: number },
): EvidenceUnit[][] {
  const result: EvidenceUnit[][] = []
  let current: EvidenceUnit[] = []
  let tokens = 0
  for (const unit of units) {
    const boundedTokens = Math.max(1, Math.trunc(unit.estimatedTokens))
    const sameWindow = current.length === 0 || (
      current[0]!.evidenceWindow === unit.evidenceWindow &&
      (current[0]!.errorClass ?? null) === (unit.errorClass ?? null)
    )
    const exceedsTarget = current.length > 0 && (
      tokens + boundedTokens > options.targetTokens ||
      current.length >= options.maximumRecords
    )
    if (!sameWindow || exceedsTarget) {
      result.push(current)
      current = []
      tokens = 0
    }
    if (boundedTokens > options.hardTokens) {
      result.push([{ ...unit, estimatedTokens: options.hardTokens }])
      continue
    }
    current.push(unit)
    tokens += boundedTokens
  }
  if (current.length > 0) result.push(current)
  return result
}

export function shouldRunQualityCheck(input: {
  profileKey: string
  sampleKey: string
  checkedCount: number
  materialErrorCount: number
  forcedFullBatchesRemaining: number
}): boolean {
  if (input.forcedFullBatchesRemaining > 0 || input.checkedCount < 1_000) {
    return true
  }
  const rate = input.materialErrorCount / Math.max(1, input.checkedCount)
  if (rate >= 0.01) return true
  const digest = createHash('sha256')
    .update(`${input.profileKey}\0${input.sampleKey}`)
    .digest()
  return digest.readUInt32BE(0) % 10 === 0
}

const secretPatterns: Array<[RegExp, string]> = [
  [/\b(?:password|passwd|pwd)\s*[:=]\s*([^\s,;]+)/gi, 'password=<SECRET>'],
  [/\b(?:api[_ -]?key|access[_ -]?token|secret)\s*[:=]\s*([^\s,;]+)/gi, '$&<SECRET>'],
  [/\b(?:Bearer)\s+[A-Za-z0-9._~+/=-]{12,}/gi, 'Bearer <SECRET>'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    '<PRIVATE_KEY>'],
  [/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g, '<ACCESS_KEY>']
]

function stablePlaceholders(
  text: string,
  pattern: RegExp,
  label: string,
): string {
  const values = new Map<string, string>()
  return text.replace(pattern, (value) => {
    const normalized = value.toLowerCase()
    let replacement = values.get(normalized)
    if (!replacement) {
      replacement = `<${label}_${values.size + 1}>`
      values.set(normalized, replacement)
    }
    return replacement
  })
}

export function sanitizeFieldLog(raw: string): {
  sanitized: string
  replacements: { secrets: number; addresses: number; macs: number; hosts: number; users: number }
} {
  let sanitized = raw.replace(/\u0000/g, '')
  let secrets = 0
  for (const [pattern, replacement] of secretPatterns) {
    sanitized = sanitized.replace(pattern, () => {
      secrets += 1
      return replacement.includes('$&')
        ? replacement.replace('$&', '')
        : replacement
    })
  }
  const countBefore = (pattern: RegExp) => sanitized.match(pattern)?.length ?? 0
  const ipPattern = /\b(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}\b/g
  const macPattern = /\b(?:[0-9a-f]{2}[:-]){5}[0-9a-f]{2}\b/gi
  const hostPattern = /\b(?=[a-z0-9.-]{3,253}\b)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}\b/gi
  const userPattern = /\b(?:user(?:name)?|login)\s*[:=]\s*[A-Za-z0-9._@-]+/gi
  const addresses = countBefore(ipPattern)
  sanitized = stablePlaceholders(sanitized, ipPattern, 'IP')
  const macs = countBefore(macPattern)
  sanitized = stablePlaceholders(sanitized, macPattern, 'MAC')
  const hosts = countBefore(hostPattern)
  sanitized = stablePlaceholders(sanitized, hostPattern, 'HOST')
  const users = countBefore(userPattern)
  sanitized = stablePlaceholders(sanitized, userPattern, 'USER')
  return { sanitized, replacements: { secrets, addresses, macs, hosts, users } }
}

export type ParsedLogSession = {
  ordinal: number
  lines: string[]
  commands: string[]
  errorMarkers: string[]
}

export function parseFieldLogSessions(text: string): ParsedLogSession[] {
  const sessions: ParsedLogSession[] = []
  let lines: string[] = []
  const flush = () => {
    if (lines.length === 0) return
    const commands = lines.flatMap((line) => {
      const match = /(?:^|\s)(?:[\w.-]+(?:\([^)]*\))?[#>$])\s*(.+)$/.exec(line)
      return match?.[1]?.trim() ? [match[1].trim()] : []
    })
    sessions.push({
      ordinal: sessions.length,
      lines,
      commands,
      errorMarkers: lines.filter((line) =>
        /(?:^|\s)(?:% ?(?:error|invalid|failed)|error:|failure|traceback)\b/i.test(line),
      )
    })
    lines = []
  }
  for (const line of text.replace(/\r/g, '').split('\n')) {
    if (/^(?:-{3,}|={3,}|session\s+(?:start|end)|disconnected|connection closed)/i.test(line.trim())) {
      flush()
      continue
    }
    if (line.trim()) lines.push(line)
  }
  flush()
  return sessions
}

export function publicSourceLocator(publicBaseUrl: string, sourceRef: string): string {
  return new URL(`/sources/${encodeURIComponent(sourceRef)}`, publicBaseUrl)
    .toString()
}

export function isUrlInsideCollectionScope(
  candidate: string,
  root: string,
  pathPrefix?: string,
): boolean {
  try {
    const rootUrl = new URL(root)
    const candidateUrl = new URL(candidate)
    const prefix = pathPrefix ?? (
      rootUrl.pathname.endsWith('/')
        ? rootUrl.pathname
        : `${rootUrl.pathname.slice(0, rootUrl.pathname.lastIndexOf('/') + 1)}`
    )
    return candidateUrl.protocol === 'https:' &&
      candidateUrl.hostname.toLowerCase() === rootUrl.hostname.toLowerCase() &&
      (candidateUrl.port || '443') === (rootUrl.port || '443') &&
      candidateUrl.pathname.startsWith(prefix)
  } catch {
    return false
  }
}
