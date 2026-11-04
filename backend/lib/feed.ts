// Official gauge feeds differ from source to source. This turns a JSON feed shaped
// [{id,name,river,lat,lon,lvl,danger,ts?}] into clean readings and drops anything implausible.
// A source with a different shape needs a small adapter that outputs this shape.
export interface Rd {
  id: string
  name: string
  river: string
  lat: number
  lon: number
  lvl: number
  danger: number
  ts: number | null // observation time (ms), if the feed supplies one
  sim: boolean
}

export const STALE_MS = 3 * 3600_000

function when(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v < 1e12 ? v * 1000 : v // seconds or ms
  if (typeof v === 'string') {
    const t = Date.parse(v)
    return Number.isFinite(t) ? t : null
  }
  return null
}

export function normalize(js: unknown): { rows: Rd[]; dropped: number } {
  const arr = Array.isArray(js) ? js : []
  const rows: Rd[] = []
  let dropped = 0
  for (const x of arr) {
    const o = (x ?? {}) as Record<string, unknown>
    const lvl = Number(o.lvl)
    const danger = Number(o.danger)
    const lat = Number(o.lat)
    const lon = Number(o.lon)
    const ok =
      typeof o.id === 'string' && o.id && Number.isFinite(lvl) && lvl > -5 && lvl < 200 && Number.isFinite(danger) && danger > 0 && danger < 200 && Number.isFinite(lat) && Number.isFinite(lon)
    if (!ok) {
      dropped++
      continue
    }
    rows.push({ id: String(o.id).slice(0, 40), name: String(o.name ?? o.id).slice(0, 60), river: String(o.river ?? '').slice(0, 40), lat, lon, lvl, danger, ts: when(o.ts), sim: false })
  }
  return { rows, dropped }
}

/** True when the reading is too old to trust for a warning. */
export const isStale = (ts: number | null, now: number): boolean => ts !== null && now - ts > STALE_MS
