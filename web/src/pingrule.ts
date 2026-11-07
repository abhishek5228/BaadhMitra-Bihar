import { hav } from '../../shared/geo'

export interface Fix {
  lat: number
  lon: number
  t: number // ms
}

export const MIN_GAP = 25_000 // never faster than this
export const MOVED_M = 50 // a real move worth reporting
export const HEARTBEAT = 180_000 // standing still: one "still here" every 3 minutes

/**
 * Decide whether a new GPS fix is worth sending. A crew standing at a flooded house should not
 * keep the radio busy every 25 seconds; one that is moving should show up promptly.
 */
export function shouldPing(prev: Fix | null, next: Fix): boolean {
  if (!prev) return true
  const dt = next.t - prev.t
  if (dt < MIN_GAP) return false
  if (dt >= HEARTBEAT) return true
  return hav(prev.lat, prev.lon, next.lat, next.lon) * 1000 >= MOVED_M
}
