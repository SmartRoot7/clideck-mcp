import type { DomainPack } from './pack.js'
import {
  domainPackManifestV1Schema,
  semverSchema,
  type DomainPackManifestV1
} from './manifest.js'

export const DOMAIN_PACK_API_VERSION = '1.0.0'

type ParsedSemver = readonly [number, number, number]

function parseSemver(value: string): ParsedSemver {
  semverSchema.parse(value)
  const [major, minor, patchWithPrerelease] = value.split('.')
  const patch = patchWithPrerelease?.split('-')[0]
  return [
    Number(major),
    Number(minor),
    Number(patch)
  ]
}

function compareSemver(left: string, right: string): number {
  const parsedLeft = parseSemver(left)
  const parsedRight = parseSemver(right)
  for (let index = 0; index < parsedLeft.length; index += 1) {
    const difference = parsedLeft[index]! - parsedRight[index]!
    if (difference !== 0) return Math.sign(difference)
  }
  return 0
}

export function assertManifestCompatibility(
  manifestInput: unknown,
  coreVersion = DOMAIN_PACK_API_VERSION,
): DomainPackManifestV1 {
  const manifest = domainPackManifestV1Schema.parse(manifestInput)
  if (compareSemver(coreVersion, manifest.core_compatibility.minimum) < 0) {
    throw new Error(
      `DOMAIN_PACK_REQUIRES_CORE_${manifest.core_compatibility.minimum}`,
    )
  }
  if (
    manifest.core_compatibility.maximum &&
    compareSemver(coreVersion, manifest.core_compatibility.maximum) > 0
  ) {
    throw new Error(
      `DOMAIN_PACK_MAXIMUM_CORE_${manifest.core_compatibility.maximum}`,
    )
  }
  return manifest
}

export class DomainPackRegistry {
  readonly #packs = new Map<string, DomainPack>()
  readonly #coreVersion: string

  constructor(coreVersion = DOMAIN_PACK_API_VERSION) {
    semverSchema.parse(coreVersion)
    this.#coreVersion = coreVersion
  }

  register(pack: DomainPack): void {
    const manifest = assertManifestCompatibility(
      pack.manifest,
      this.#coreVersion,
    )
    if (this.#packs.has(manifest.id)) {
      throw new Error(`DOMAIN_PACK_DUPLICATE_ID:${manifest.id}`)
    }
    this.#packs.set(manifest.id, pack)
  }

  get(domainId: string): DomainPack {
    const pack = this.#packs.get(domainId)
    if (!pack) throw new Error(`DOMAIN_PACK_NOT_FOUND:${domainId}`)
    return pack
  }

  list(): DomainPackManifestV1[] {
    return [...this.#packs.values()]
      .map((pack) => pack.manifest)
      .sort((left, right) => left.id.localeCompare(right.id))
  }
}
