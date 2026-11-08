// River gauge stations used by the early-warning poller and the demo.
// The danger marks are the official CWC ones (shared/cwc.ts). Coordinates are approximate, and the LEVELS
// from simlvl() below are simulated and always flagged `sim`.
// In production the poller reads official levels from a feed (GAUGE_FEED_URL).
import { ref } from './cwc'

export interface Stn {
  id: string
  name: string
  river: string
  lat: number
  lon: number
  danger: number // metres
  base: number // typical monsoon-season level used by the simulator
}

const st = (id: string, base: number): Stn => {
  const r = ref(id)
  return { id, name: r.name, river: r.river, lat: r.lat, lon: r.lon, danger: r.danger, base }
}

export const STATIONS: Stn[] = [st('gandhighat', 46.9), st('hathidah', 40.2), st('kursela', 28.4), st('baltara', 32.25), st('basua', 46.0), st('hajipur', 48.7)]

/**
 * Deterministic simulated level for a station at time t (ms): a slow monsoon swell plus a
 * faster wobble, so the demo (and an unconfigured deployment) shows warn and danger states
 * on a repeating 12 hour cycle. Always flagged `sim` so nobody mistakes it for a real reading.
 */
export function simlvl(s: Stn, t: number): number {
  const h = t / 3600_000
  const k = s.id.split('').reduce((a, c) => a + c.charCodeAt(0), 0) % 7
  const swell = Math.sin(((h + k) / 12) * 2 * Math.PI)
  const wob = Math.sin((h + k) * 1.7) * 0.15
  return Math.round((s.base + swell * 1.6 + wob) * 100) / 100
}
