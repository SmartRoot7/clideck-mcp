import {
  compareNormalizedVersions,
  isVersionApplicable,
  normalizeVendorVersion
} from '../src/version.js'

describe('vendor version normalization', () => {
  it('orders Cisco-style trains deterministically', () => {
    expect(
      compareNormalizedVersions(
        normalizeVendorVersion('17.9.4a'),
        normalizeVendorVersion('17.9.4'),
      ),
    ).toBeGreaterThan(0)
    expect(
      compareNormalizedVersions(
        normalizeVendorVersion('16.12.10'),
        normalizeVendorVersion('17.3.1'),
      ),
    ).toBeLessThan(0)
  })

  it('enforces minimum and maximum versions', () => {
    expect(
      isVersionApplicable(
        '17.9.4',
        normalizeVendorVersion('16.6'),
        normalizeVendorVersion('17.12'),
      ),
    ).toBe(true)
    expect(
      isVersionApplicable(
        '16.3.1',
        normalizeVendorVersion('16.6'),
        null,
      ),
    ).toBe(false)
  })
})
