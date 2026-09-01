import { describe, expect, it } from 'vitest'

import { knowledgeRevisionSchema } from '../packages/admin-contracts/src/index.js'

describe('admin contracts', () => {
  it('accepts vendor-neutral network knowledge', () => {
    expect(knowledgeRevisionSchema.shape.vendor_slug.parse(null)).toBeNull()
  })
})
