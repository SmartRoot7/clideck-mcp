/** Run at most one maintenance job while foreground work continues. */
export function backgroundMaintenance(operation: () => Promise<unknown>, onError: (error: unknown) => void) {
  let running: Promise<unknown> | null = null
  return {
    start() {
      if (!running) running = operation().catch(onError).finally(() => { running = null })
    },
    async finish() { await running }
  }
}
