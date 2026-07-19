import {
  runDomainPackConformance
} from '@clideck/domain-kit'
import { expect, it } from 'vitest'

import {
  conformanceFixture,
  domainPack
} from './pack.js'

it('passes Domain Kit conformance', () => {
  expect(runDomainPackConformance(
    domainPack,
    conformanceFixture,
  ).passed).toBe(true)
})
