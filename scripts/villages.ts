// Build shared/villages.json from a village dataset you have the right to use.
//   npx tsx scripts/villages.ts overpass.json
//   npx tsx scripts/villages.ts villages.csv      (header: name,hi,lat,lon)
// An Overpass export for Bihar is described in docs/DEPLOY-INDIA.md (use `out center;` so mapped areas are included).
// Check the data licence (OpenStreetMap data is ODbL: keep the attribution) before shipping it.
import { readFileSync, writeFileSync } from 'node:fs'
import { build, fromCsv, fromOverpass } from './vlib'

const file = process.argv[2]
if (!file) {
  console.error('usage: tsx scripts/villages.ts <overpass.json | villages.csv>')
  process.exit(1)
}
const raw = readFileSync(file, 'utf-8')
const rows = file.endsWith('.json') ? fromOverpass(raw) : fromCsv(raw)
const out = build(rows)
writeFileSync(new URL('../shared/villages.json', import.meta.url), JSON.stringify(out))
console.log(`wrote ${out.length} villages (from ${rows.length} rows; ${rows.length - out.length} dropped as outside Bihar or duplicate)`)
