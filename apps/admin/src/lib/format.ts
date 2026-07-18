import type { ReactNode } from 'react'

export function numberOf(value: string | number | null | undefined): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

export function compactNumber(
  value: string | number | null | undefined,
): string {
  return new Intl.NumberFormat('en-US', {
    notation: Math.abs(numberOf(value)) >= 10_000 ? 'compact' : 'standard',
    maximumFractionDigits: 1
  }).format(numberOf(value))
}

export function formatNumber(
  value: string | number | null | undefined,
  maximumFractionDigits = 2,
): string {
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits
  }).format(numberOf(value))
}

export function formatDate(
  value: string | null | undefined,
  includeDate = true,
): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat(undefined, includeDate
    ? {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      }
    : { hour: '2-digit', minute: '2-digit' }).format(date)
}

export function duration(value: string | number | null | undefined): string {
  const milliseconds = numberOf(value)
  if (!milliseconds) return '—'
  const seconds = Math.round(milliseconds / 1_000)
  const minutes = Math.floor(seconds / 60)
  const remainder = seconds % 60
  return minutes ? `${minutes}m ${remainder}s` : `${remainder}s`
}

export function shortId(value: string | null | undefined): string {
  if (!value) return '—'
  return value.length > 18
    ? `${value.slice(0, 8)}…${value.slice(-6)}`
    : value
}

export function titleCase(value: string | null | undefined): string {
  if (!value) return 'Unknown'
  return value
    .replaceAll('_', ' ')
    .replaceAll('-', ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase())
}

export type Tone = 'good' | 'warning' | 'danger' | 'neutral' | 'info'

export function toneFor(value: string | boolean | null | undefined): Tone {
  const text = String(value ?? '').toLowerCase()
  if (/(fail|error|reject|critical|offline|cancel|unhealthy|blocked)/.test(text)) {
    return 'danger'
  }
  if (/(warn|pending|queue|standby|wait|analy|partial|manual)/.test(text)) {
    return 'warning'
  }
  if (/(healthy|complete|publish|active|pass|resolve|accept|online|running)/.test(text)) {
    return 'good'
  }
  if (/(info|discover|acquire|convert|chunk|verify)/.test(text)) return 'info'
  return 'neutral'
}

export function valueNode(value: unknown): ReactNode {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (typeof value === 'number') return formatNumber(value)
  if (typeof value === 'string') return value
  return JSON.stringify(value)
}
