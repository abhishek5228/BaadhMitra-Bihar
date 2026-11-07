// Official gauge feeds differ from source to source. This turns a JSON feed shaped
// [{id,name,river,lat,lon,lvl,danger,ts?}] into clean readings and drops anything implausible.
// A source with a different shape is mapped onto this shape by adapt() below, driven by a small JSON
// config (FEED_MAP), so a new official source needs a config file, not new code.
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

/** Where each value lives in a source feed. Paths are dotted, e.g. "data.0.level". */
export interface FeedMap {
  list?: string // path to the array of readings; omit if the feed itself is the array
  id: string
  lvl: string
  name?: string
  river?: string
  lat?: string
  lon?: string
  danger?: string
  ts?: string
  scale?: number // multiply lvl and danger (e.g. 0.01 if the feed is in centimetres)
  /** Station details the feed does not carry (usually from the agency's official station list). */
  stations?: Record<string, { name?: string; river?: string; lat: number; lon: number; danger: number }>
}

const dig = (o: unknown, path?: string): unknown => {
  if (!path) return o
  let cur: unknown = o
  for (const k of path.split('.')) {
    if (cur === null || typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[k]
  }
  return cur
}

/** Reshape a foreign feed into the shape normalize() expects. Never invents a value: missing stays missing. */
export function adapt(js: unknown, map: FeedMap): unknown[] {
  const src = dig(js, map.list)
  if (!Array.isArray(src)) return []
  const k = map.scale ?? 1
  const num = (v: unknown): unknown => (v === null || v === undefined || v === '' ? undefined : Number(v))
  return src.map((x) => {
    const idv = dig(x, map.id)
    const id = idv === undefined || idv === null ? undefined : String(idv)
    const st = id ? map.stations?.[id] : undefined
    const lvl = num(dig(x, map.lvl))
    const dg = map.danger ? num(dig(x, map.danger)) : st?.danger
    return {
      id,
      name: (map.name ? dig(x, map.name) : undefined) ?? st?.name ?? id,
      river: (map.river ? dig(x, map.river) : undefined) ?? st?.river ?? '',
      lat: map.lat ? num(dig(x, map.lat)) : st?.lat,
      lon: map.lon ? num(dig(x, map.lon)) : st?.lon,
      lvl: typeof lvl === 'number' ? lvl * k : lvl,
      danger: typeof dg === 'number' ? dg * (map.danger ? k : 1) : dg,
      ts: map.ts ? dig(x, map.ts) : undefined,
    }
  })
}

/** Parse the FEED_MAP environment value; a bad value means "no mapping" rather than a crash. */
export function parseMap(raw: string | undefined): FeedMap | null {
  if (!raw) return null
  try {
    const m = JSON.parse(raw) as FeedMap
    return m && typeof m.id === 'string' && typeof m.lvl === 'string' ? m : null
  } catch {
    return null
  }
}

const BLOCKED = new Set(['host', 'content-length', 'transfer-encoding', 'connection', 'cookie'])

/**
 * Turn the secret JSON {"header": "x-api-key", "value": "..."} into request headers.
 * Anything malformed or unsafe yields no headers rather than a half-built request.
 */
export function authHeaders(raw: string | undefined): Record<string, string> {
  if (!raw) return {}
  try {
    const o = JSON.parse(raw) as { header?: unknown; value?: unknown }
    const h = typeof o.header === 'string' ? o.header.trim() : ''
    const v = typeof o.value === 'string' ? o.value : ''
    if (!h || !v || !/^[A-Za-z0-9-]{1,60}$/.test(h) || BLOCKED.has(h.toLowerCase()) || /[\r\n]/.test(v) || v.length > 2000) return {}
    return { [h]: v }
  } catch {
    return {}
  }
}
