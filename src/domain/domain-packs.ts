import { DomainPackRegistry } from '@clideck/domain-kit'
import {
  engineeringMeasurementsPack
} from '@clideck/domain-engineering-measurements'
import { networkDomainPack } from '@clideck/domain-network'

const registry = new DomainPackRegistry()
registry.register(networkDomainPack)
registry.register(engineeringMeasurementsPack)

export function getDomainPackRegistry(): DomainPackRegistry {
  return registry
}

export function getNetworkDomainPack(): typeof networkDomainPack {
  registry.get('network')
  return networkDomainPack
}
