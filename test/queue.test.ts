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
    expect(r).toEqual({ sent: 0, left: 1, failed: 0 })
    expect(read()[0].tries).toBe(1)
  })
  it('drops a report the server refuses for good, and carries on with the next', async () => {
    add('refused')
    add('fine')
    const send = vi.fn(async (i: { text: string }) => {
      if (i.text === 'refused') throw Object.assign(new Error('400'), { status: 400 })
    })
    expect(await flush(send)).toEqual({ sent: 1, left: 0, failed: 1 })
  })
  it('keeps a report the server only asked to slow down for (429) or that hit a server error', async () => {
    add('later')
    expect(await flush(async () => Promise.reject(Object.assign(new Error('429'), { status: 429 })))).toEqual({ sent: 0, left: 1, failed: 0 })
    expect(await flush(async () => Promise.reject(Object.assign(new Error('503'), { status: 503 })))).toEqual({ sent: 0, left: 1, failed: 0 })
  })
  it('removes a report once it is sent', async () => {
    add('one')
    add('two')
    expect(await flush(async () => undefined)).toEqual({ sent: 2, left: 0, failed: 0 })
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
