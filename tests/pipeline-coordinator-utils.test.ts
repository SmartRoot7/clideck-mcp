import { describe, expect, it, vi } from 'vitest'

import {
  pipelineControlStop,
  retryBridgeArtifactSubmission
} from '../src/cli/pipeline-coordinator-utils.js'

describe('pipeline coordinator reliability helpers', () => {
  it('distinguishes a lost lease from an administrative pause', () => {
    expect(pipelineControlStop({ should_stop: false })).toBeNull()
    expect(pipelineControlStop({
      should_stop: true,
      reason: 'pipeline_paused'
    })).toBe('paused')
    expect(pipelineControlStop({
      should_stop: true,
      reason: 'lease_invalid'
    })).toBe('lease_lost')
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
