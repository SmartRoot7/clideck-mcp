import { describe, expect, it, vi } from 'vitest'
import { hasInvalidLaunchdBootstrap } from '../src/cli/launchd-context.js'

const invalidBootstrap = {
  code: 153,
  stderr: 'Could not get manager PID.\n'
}

describe('launchd bootstrap health', () => {
  it('confirms the invalid bootstrap before recycling the pool', async () => {
    const probe = vi.fn().mockRejectedValue(invalidBootstrap)
    await expect(hasInvalidLaunchdBootstrap({ platform: 'darwin', probe }))
      .resolves.toBe(true)
    expect(probe).toHaveBeenCalledTimes(2)
  })

  it('leaves a healthy bootstrap alone', async () => {
    const probe = vi.fn().mockResolvedValue(undefined)
    await expect(hasInvalidLaunchdBootstrap({ platform: 'darwin', probe }))
      .resolves.toBe(false)
    expect(probe).toHaveBeenCalledOnce()
  })

  it('does not recycle when the confirming probe recovers', async () => {
    const probe = vi.fn().mockRejectedValueOnce(invalidBootstrap)
      .mockResolvedValueOnce(undefined)
    await expect(hasInvalidLaunchdBootstrap({ platform: 'darwin', probe }))
      .resolves.toBe(false)
  })

  it.each([
    { code: 'ETIMEDOUT', stderr: 'Could not get manager PID.' },
    { code: 'ENOENT' },
    { code: 1, stderr: 'Could not get manager PID.' },
    { code: 153, stderr: 'An unrelated failure' }
  ])('does not recycle on an unconfirmed probe error: %j', async (failure) => {
    const probe = vi.fn().mockRejectedValue(failure)
    await expect(hasInvalidLaunchdBootstrap({ platform: 'darwin', probe }))
      .resolves.toBe(false)
    expect(probe).toHaveBeenCalledOnce()
  })

  it('does not run launchctl on Linux', async () => {
    const probe = vi.fn()
    await expect(hasInvalidLaunchdBootstrap({ platform: 'linux', probe }))
      .resolves.toBe(false)
    expect(probe).not.toHaveBeenCalled()
  })
})
