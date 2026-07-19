import { DomainPackRegistry } from '@clideck/domain-kit'
import { networkDomainPack } from '@clideck/domain-network'

const registry = new DomainPackRegistry()
registry.register(networkDomainPack)

export function getDomainPackRegistry(): DomainPackRegistry {
  return registry
}

export function getNetworkDomainPack(): typeof networkDomainPack {
  registry.get('network')
  return networkDomainPack
}
