// A half-written report survives an accidental reload or a phone that dies: people write these in a panic, on bad phones.
export interface Draft {
  place: string
  ppl: string
  free: string
  needs: string[]
  ts: number
}
const K = 'bmdraft'
export const KEEP_MS = 6 * 3600_000

export function saveDraft(d: Omit<Draft, 'ts'>, now = Date.now()): void {
  try {
    if (!d.place.trim() && !d.ppl.trim() && !d.free.trim() && !d.needs.length) localStorage.removeItem(K)
    else localStorage.setItem(K, JSON.stringify({ ...d, ts: now }))
  } catch {
    /* storage blocked or full: nothing more to do on this phone */
  }
}

/** The saved draft if it is recent and well-formed; anything else is ignored. */
export function loadDraft(now = Date.now()): Draft | null {
  try {
    const v = JSON.parse(localStorage.getItem(K) ?? 'null') as Partial<Draft> | null
    if (!v || typeof v.ts !== 'number' || now - v.ts > KEEP_MS || now < v.ts) return null
    const s = (x: unknown, n: number): string => (typeof x === 'string' ? x.slice(0, n) : '')
    return { place: s(v.place, 80), ppl: s(v.ppl, 4), free: s(v.free, 600), needs: Array.isArray(v.needs) ? v.needs.filter((x): x is string => typeof x === 'string').slice(0, 10) : [], ts: v.ts }
  } catch {
    return null
  }
}

export function clearDraft(): void {
  try {
    localStorage.removeItem(K)
  } catch {
    /* ignore */
  }
}
