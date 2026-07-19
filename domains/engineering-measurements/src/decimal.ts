import { z } from 'zod'

export const exactDecimalSchema = z.string().regex(
  /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/,
  'Use a canonical decimal string without exponent notation.',
)

type ParsedDecimal = {
  coefficient: bigint
  scale: number
}

function parseDecimal(value: string): ParsedDecimal {
  exactDecimalSchema.parse(value)
  const negative = value.startsWith('-')
  const unsigned = negative ? value.slice(1) : value
  const [integer, fraction = ''] = unsigned.split('.')
  const coefficient = BigInt(`${integer}${fraction}`)
  return {
    coefficient: negative ? -coefficient : coefficient,
    scale: fraction.length
  }
}

function powerOfTen(exponent: number): bigint {
  return 10n ** BigInt(exponent)
}

export function compareExactDecimals(left: string, right: string): number {
  const parsedLeft = parseDecimal(left)
  const parsedRight = parseDecimal(right)
  const scale = Math.max(parsedLeft.scale, parsedRight.scale)
  const normalizedLeft =
    parsedLeft.coefficient * powerOfTen(scale - parsedLeft.scale)
  const normalizedRight =
    parsedRight.coefficient * powerOfTen(scale - parsedRight.scale)
  if (normalizedLeft === normalizedRight) return 0
  return normalizedLeft < normalizedRight ? -1 : 1
}

export function isNonnegativeDecimal(value: string): boolean {
  return compareExactDecimals(value, '0') >= 0
}
