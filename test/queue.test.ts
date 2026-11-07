import { beforeEach, describe, expect, it, vi } from 'vitest'
import { add, flush, read } from '../web/src/queue'

beforeEach(() => {
  const m = new Map<string, string>()
  vi.stubGlobal('localStorage', { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) })
})

describe('offline outbox', () => {
  it('keeps a report when sending fails and counts the try', async () => {
    add('Rampur me paani')
    const r = await flush(async () => Promise.reject(new Error('offline')))
    expect(r).toEqual({ sent: 0, left: 1 })
    expect(read()[0].tries).toBe(1)
  })
  it('removes a report once it is sent', async () => {
    add('one')
    add('two')
    expect(await flush(async () => undefined)).toEqual({ sent: 2, left: 0 })
  })
  it('never sends the same report twice when flushes overlap', async () => {
    add('only once')
    const send = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 20))
    })
    const [a, b] = await Promise.all([flush(send), flush(send)])
    expect(send).toHaveBeenCalledTimes(1)
    expect(a).toEqual(b)
  })
  it('stops at the first failure instead of hammering a dead network', async () => {
    add('a')
    add('b')
    add('c')
    const send = vi.fn(async () => Promise.reject(new Error('down')))
    await flush(send)
    expect(send).toHaveBeenCalledTimes(1)
  })
})
