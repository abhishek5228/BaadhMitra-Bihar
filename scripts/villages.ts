// Build shared/villages.json from a village dataset you have the right to use.
//   npx tsx scripts/villages.ts overpass.json
//   npx tsx scripts/villages.ts villages.csv      (columns: name,hi,lat,lon)
// An Overpass export for Bihar is described in docs/DEPLOY-INDIA.md. Check the data licence
// (OpenStreetMap data is ODbL: keep the attribution) before shipping it.
import { readFileSync, writeFileSync } from 'node:fs'
import { nearest } from '../shared/gazetteer'
import { inBihar } from '../shared/geo'
import type { Vil } from '../shared/villages'

const file = process.argv[2]
if (!file) {
  console.error('usage: tsx scripts/villages.ts <overpass.json | villages.csv>')
  process.exit(1)
}
const raw = readFileSync(file, 'utf-8')
const rows: { name: string; hi: string; lat: number; lon: number }[] = []

if (file.endsWith('.json')) {
  const js = JSON.parse(raw) as { elements?: { lat?: number; lon?: number; tags?: Record<string, string> }[] }
  for (const e of js.elements ?? []) {
    const t = e.tags ?? {}
    const en = t['name:en'] ?? (/[A-Za-z]/.test(t.name ?? '') ? t.name : '')
    const hi = t['name:hi'] ?? (/[ऀ-ॿ]/.test(t.name ?? '') ? t.name : '')
    if (e.lat !== undefined && e.lon !== undefined && (en || hi)) rows.push({ name: en ?? '', hi: hi ?? '', lat: e.lat, lon: e.lon })
  }
} else {
  for (const line of raw.split(/\r?\n/).slice(1)) {
    const [name = '', hi = '', lat = '', lon = ''] = line.split(',').map((x) => x.trim())
    if (lat && lon) rows.push({ name, hi, lat: Number(lat), lon: Number(lon) })
  }
}

const seen = new Set<string>()
const out: Vil[] = []
for (const r of rows) {
  if (!Number.isFinite(r.lat) || !Number.isFinite(r.lon) || !inBihar(r.lat, r.lon)) continue
  const k = `${r.name.toLowerCase()}|${r.hi}|${r.lat.toFixed(3)}|${r.lon.toFixed(3)}`
  if (seen.has(k)) continue
  seen.add(k)
  out.push([r.name.toLowerCase(), r.hi, Math.round(r.lat * 1e4) / 1e4, Math.round(r.lon * 1e4) / 1e4, nearest(r.lat, r.lon).p.en])
}
writeFileSync(new URL('../shared/villages.json', import.meta.url), JSON.stringify(out))
console.log(`wrote ${out.length} villages (from ${rows.length} rows)`)
