import { describe, expect, it, vi } from 'vitest'

import {
  containsWebSearchEvent,
  retryBridgeArtifactSubmission
} from '../src/cli/pipeline-coordinator-utils.js'

describe('pipeline coordinator reliability helpers', () => {
  it('requires an actual nested web-search runtime event', () => {
    expect(containsWebSearchEvent({ item: { type: 'web_search_call' } }))
      .toBe(true)
    expect(containsWebSearchEvent({ message: 'I searched the web' }))
      .toBe(false)
  })

  it('retries only bridge delivery with bounded backoff', async () => {
    const submit = vi.fn()
      .mockRejectedValueOnce(new Error('tunnel closed'))
      .mockRejectedValueOnce(new Error('tunnel closed'))
      .mockResolvedValue(undefined)
    const sleep = vi.fn().mockResolvedValue(undefined)
    await retryBridgeArtifactSubmission({
      submit,
      isRecorded: vi.fn().mockResolvedValue(false),
      heartbeat: vi.fn().mockResolvedValue(true),
      sleep
    })
    expect(submit).toHaveBeenCalledTimes(3)
    expect(sleep.mock.calls.map(([waitMs]) => waitMs)).toEqual([2_000, 5_000])
  })

  it('stops after the bounded retry sequence', async () => {
    const submit = vi.fn().mockRejectedValue(new Error('offline'))
    await expect(retryBridgeArtifactSubmission({
      submit,
      isRecorded: vi.fn().mockResolvedValue(false),
      heartbeat: vi.fn().mockResolvedValue(true),
      sleep: vi.fn().mockResolvedValue(undefined)
    })).rejects.toThrow('offline')
    expect(submit).toHaveBeenCalledTimes(6)
  })
})
