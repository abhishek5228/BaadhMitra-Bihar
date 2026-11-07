// Small pure helpers for the live dashboard, kept apart from the page so they can be tested without a browser.
import type { Inc } from '../../shared/types'

/** Browser tab title: the control room often keeps this tab in the background, so the count must show there. */
export function tabTitle(open: number, late: number, base: string): string {
  if (late > 0) return `(⏰ ${late}) ${base}`
  if (open > 0) return `(${open}) ${base}`
  return base
}

/** Data older than this is called out in the header, so nobody acts on a stale queue without knowing. */
export const STALE_AFTER_MS = 20_000

/** null while data is fresh; otherwise the time of the last good refresh. */
export function lastGood(lastOk: number, now: number): number | null {
  return lastOk > 0 && now - lastOk > STALE_AFTER_MS ? lastOk : null
}

export const URGENT = 75

/** Incidents that are new on this screen and urgent: the ones worth a sound. Closed ones never are. */
export function newUrgent(seen: ReadonlySet<string>, incs: Inc[]): Inc[] {
  return incs.filter((i) => i.status === 'open' && i.score >= URGENT && !seen.has(i.id))
}

/** Next or previous incident id in the shown order; wraps round, and starts at the first or last when nothing is selected. */
export function step(ids: string[], sel: string, dir: 1 | -1): string {
  if (!ids.length) return ''
  const at = ids.indexOf(sel)
  if (at < 0) return dir === 1 ? ids[0] : ids[ids.length - 1]
  return ids[(at + dir + ids.length) % ids.length]
}

const LK = 'bmlang'
const SK = 'bmsound'

export function loadLang(fallback: 'en' | 'hi'): 'en' | 'hi' {
  try {
    const v = localStorage.getItem(LK)
    return v === 'en' || v === 'hi' ? v : fallback
  } catch {
    return fallback
  }
}
export function saveLang(l: 'en' | 'hi'): void {
  try {
    localStorage.setItem(LK, l)
  } catch {
    /* private mode: the choice just will not be remembered */
  }
}
export function loadSound(): boolean {
  try {
    return localStorage.getItem(SK) === '1'
  } catch {
    return false
  }
}
export function saveSound(on: boolean): void {
  try {
    localStorage.setItem(SK, on ? '1' : '0')
  } catch {
    /* ignore */
  }
}
