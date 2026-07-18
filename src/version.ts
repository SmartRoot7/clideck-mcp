import { z } from 'zod'

export const networkVersionSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9][A-Za-z0-9()._\-/]*$/)

export function normalizeVendorVersion(version: string): number[] {
  const components = version
    .toLowerCase()
    .match(/[0-9]+|[a-z]+/g)

  if (!components) return []

  return components.slice(0, 16).map((component) => {
    if (/^\d+$/.test(component)) {
      return Math.min(Number.parseInt(component, 10), 2_000_000_000)
    }

    let score = 0
    for (const character of component.slice(0, 6)) {
      score = score * 27 + character.charCodeAt(0) - 96
    }
    return 1_000_000_000 + score
  })
}

export function compareNormalizedVersions(
  left: number[],
  right: number[],
): number {
  const width = Math.max(left.length, right.length)
  for (let index = 0; index < width; index += 1) {
    const leftValue = left[index] ?? 0
    const rightValue = right[index] ?? 0
    if (leftValue !== rightValue) return leftValue < rightValue ? -1 : 1
  }
  return 0
}

export function isVersionApplicable(
  version: string | undefined,
  minimum: number[] | null,
  maximum: number[] | null,
): boolean {
  if (!version) return true
  const normalized = normalizeVendorVersion(version)
  if (minimum && compareNormalizedVersions(normalized, minimum) < 0) return false
  if (maximum && compareNormalizedVersions(normalized, maximum) > 0) return false
  return true
}
