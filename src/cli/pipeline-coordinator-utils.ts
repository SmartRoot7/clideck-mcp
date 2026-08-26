export function containsWebSearchEvent(value: unknown): boolean {
  if (typeof value === 'string') {
    return ['web_search', 'web_search_call', 'standalone_web_search']
      .includes(value.toLowerCase())
  }
  if (!value || typeof value !== 'object') return false
  return Object.values(value).some(containsWebSearchEvent)
}

export async function retryBridgeArtifactSubmission(callbacks: {
  submit: () => Promise<void>
  isRecorded: () => Promise<boolean>
  heartbeat: () => Promise<boolean>
  sleep: (waitMs: number) => Promise<void>
}, retryDelays = [2_000, 5_000, 10_000, 20_000, 30_000]) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await callbacks.submit()
      return
    } catch (error) {
      if (await callbacks.isRecorded()) return
      const waitMs = retryDelays[attempt]
      if (waitMs === undefined) throw error
      await callbacks.sleep(waitMs)
      if (!await callbacks.heartbeat()) {
        throw new Error('PIPELINE_STOPPED_DURING_ARTIFACT_REPORTING')
      }
    }
  }
}
