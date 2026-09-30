import { describe, expect, it } from 'vitest'
import { backgroundMaintenance } from '../src/background-maintenance.js'

describe('background statistics maintenance', () => {
  it('lets source processing continue while a single refresh is unfinished', async () => {
    let finish!: () => void
    let calls = 0
    const refresh = backgroundMaintenance(() => { calls++; return new Promise<void>((resolve) => { finish=resolve }) }, () => undefined)
    refresh.start()
    refresh.start()
    expect(calls).toBe(1)
    let sourceProcessed = false
    await Promise.resolve().then(() => { sourceProcessed=true })
    expect(sourceProcessed).toBe(true)
    finish()
    await refresh.finish()
    refresh.start()
    expect(calls).toBe(2)
    finish()
    await refresh.finish()
  })
  it('reports a refresh failure and permits a later attempt', async () => {
    const errors: unknown[] = []
    const refresh = backgroundMaintenance(async () => { throw new Error('stats unavailable') }, (error) => { errors.push(error) })
    refresh.start()
    await refresh.finish()
    refresh.start()
    await refresh.finish()
    expect(errors).toHaveLength(2)
  })
})
