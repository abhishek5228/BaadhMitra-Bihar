import { hav } from './geo'
import type { Inc, Team } from './types'

/** Average speed through flood-affected ground, km/h. A deliberately slow starting value, to be agreed with real crews. */
export const SPEED = 20
/** A position older than this is shown but not trusted (crews ping every few minutes while sharing). */
export const FRESH_MS = 30 * 60_000
/** Extra minutes charged against a crew that is already on another incident. */
export const BUSY_PENALTY = 60

export interface Sug {
  id: string
  km: number
  eta: number // minutes, including penalties
  busy: boolean
  stale: boolean // position older than FRESH_MS
}

/**
 * Rank crews for an incident by estimated time to reach it. A suggestion for the dispatcher, never an order.
 * Free crews with a recent position come first; a busy crew only wins if it is much closer.
 * Crews that have not shared any position cannot be ranked and are left out (the dispatcher can still pick them).
 */
export function suggest(inc: Pick<Inc, 'lat' | 'lon'>, teams: Team[], now: number, max = 3): Sug[] {
  const out: Sug[] = []
  for (const t of teams) {
    if (!Number.isFinite(t.lat) || !Number.isFinite(t.lon) || !t.ts) continue
    const km = hav(inc.lat, inc.lon, t.lat, t.lon)
    const age = Math.max(0, now - t.ts)
    const stale = age > FRESH_MS
    // Travel time, plus half the age of the fix in minutes: an old position could be off by that much driving.
    const eta = (km / SPEED) * 60 + (t.busy ? BUSY_PENALTY : 0) + (stale ? age / 120_000 : 0)
    out.push({ id: t.id, km: Math.round(km * 10) / 10, eta: Math.round(eta), busy: !!t.busy, stale })
  }
  return out.sort((a, b) => a.eta - b.eta || a.km - b.km).slice(0, max)
}
