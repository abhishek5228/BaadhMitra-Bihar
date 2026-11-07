// Offline-first outbox. A report typed with no signal is kept on the phone and sent when the network
// returns. Nothing leaves the phone until the person presses send, and a sent item is removed at once.
import type { Pin } from './api'

export interface Item {
  id: string
  text: string
  pin?: Pin
  ts: number
  tries: number
}
const K = 'bmoutbox'
const MAX = 20 // a phone that has queued 20 unsent reports is not going to get more useful by queuing more

export function read(): Item[] {
  try {
    const v = JSON.parse(localStorage.getItem(K) ?? '[]') as Item[]
    return Array.isArray(v) ? v.filter((x) => x && typeof x.text === 'string') : []
  } catch {
    return []
  }
}
function write(a: Item[]): void {
  try {
    localStorage.setItem(K, JSON.stringify(a.slice(-MAX)))
  } catch {
    /* storage full or blocked: nothing more we can do on this device */
  }
}

export function add(text: string, pin?: Pin, now = Date.now()): Item {
  const it: Item = { id: now.toString(36) + Math.random().toString(36).slice(2, 6), text, pin, ts: now, tries: 0 }
  write([...read(), it])
  return it
}

/**
 * Try to send everything waiting. `send` rejects when offline or the server fails; the item then stays.
 * Returns how many were delivered and how many are still waiting.
 */
let busy: Promise<{ sent: number; left: number }> | null = null

export function flush(send: (i: Item) => Promise<void>): Promise<{ sent: number; left: number }> {
  // The timer, the "online" event and the send button can all call this at once. One run at a time,
  // otherwise the same report would be posted twice and counted as two reporters.
  busy ??= run(send).finally(() => {
    busy = null
  })
  return busy
}

async function run(send: (i: Item) => Promise<void>): Promise<{ sent: number; left: number }> {
  let sent = 0
  for (const it of read()) {
    try {
      await send(it)
      write(read().filter((x) => x.id !== it.id))
      sent++
    } catch {
      write(read().map((x) => (x.id === it.id ? { ...x, tries: x.tries + 1 } : x)))
      break // still offline: do not hammer the network with the rest
    }
  }
  return { sent, left: read().length }
}
