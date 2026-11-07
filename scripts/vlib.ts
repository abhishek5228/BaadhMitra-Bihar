import { nearest } from '../shared/gazetteer'
import { inBihar } from '../shared/geo'
import { parseCsv } from '../shared/csvp'
import type { Vil } from '../shared/villages'

export interface Row {
  name: string
  hi: string
  lat: number
  lon: number
}

interface El {
  lat?: number
  lon?: number
  center?: { lat?: number; lon?: number } // ways and relations from `out center;`
  tags?: Record<string, string>
}

/** Rows from an Overpass JSON export. Nodes carry lat/lon; ways and relations carry `center`. */
export function fromOverpass(raw: string): Row[] {
  const js = JSON.parse(raw) as { elements?: El[] }
  const out: Row[] = []
  for (const e of js.elements ?? []) {
    const t = e.tags ?? {}
    const lat = e.lat ?? e.center?.lat
    const lon = e.lon ?? e.center?.lon
    const en = t['name:en'] || (/[A-Za-z]/.test(t.name ?? '') ? t.name : '')
    const hi = t['name:hi'] || (/[\u0900-\u097F]/.test(t.name ?? '') ? t.name : '')
    if (lat !== undefined && lon !== undefined && (en || hi)) out.push({ name: en ?? '', hi: hi ?? '', lat, lon })
  }
  return out
}

/** Rows from a CSV with a header and columns name,hi,lat,lon (any order, matched by header name). */
export function fromCsv(raw: string): Row[] {
  const [h, ...rows] = parseCsv(raw)
  if (!h) return []
  const ix = (n: string) => h.map((x) => x.trim().toLowerCase()).indexOf(n)
  const [a, b, c, d] = [ix('name'), ix('hi'), ix('lat'), ix('lon')]
  if (c < 0 || d < 0) throw new Error('CSV needs the columns name, hi, lat, lon')
  return rows.filter((r) => r[c] && r[d]).map((r) => ({ name: (r[a] ?? '').trim(), hi: (r[b] ?? '').trim(), lat: Number(r[c]), lon: Number(r[d]) }))
}

/** Drop anything outside Bihar or duplicated, and tag each village with its nearest known town. */
export function build(rows: Row[]): Vil[] {
  const seen = new Set<string>()
  const out: Vil[] = []
  for (const r of rows) {
    if (!Number.isFinite(r.lat) || !Number.isFinite(r.lon) || !inBihar(r.lat, r.lon)) continue
    const k = `${r.name.toLowerCase()}|${r.hi}|${r.lat.toFixed(3)}|${r.lon.toFixed(3)}`
    if (seen.has(k)) continue
    seen.add(k)
    out.push([r.name.toLowerCase(), r.hi, Math.round(r.lat * 1e4) / 1e4, Math.round(r.lon * 1e4) / 1e4, nearest(r.lat, r.lon).p.en])
  }
  return out
}
