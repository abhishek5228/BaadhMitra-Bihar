// Check a gauge feed before wiring it in.
//   npm run feed:check -- <url or file.json> [map.json]
// Prints what BaadhMitra would show: usable readings, dropped rows, stale readings, and how each station sits against its danger mark.
import { readFileSync } from 'node:fs'
import { adapt, isStale, normalize, type FeedMap } from '../backend/lib/feed'

const [src, mapf] = process.argv.slice(2)
if (!src) {
  console.log('usage: npm run feed:check -- <url or file.json> [map.json]')
  process.exit(1)
}
const raw: unknown = /^https?:/.test(src) ? await (await fetch(src, { signal: AbortSignal.timeout(15000) })).json() : JSON.parse(readFileSync(src, 'utf-8'))
const map = mapf ? (JSON.parse(readFileSync(mapf, 'utf-8')) as FeedMap) : null
const { rows, dropped } = normalize(map ? adapt(raw, map) : raw)
const now = Date.now()
console.log(`${rows.length} usable, ${dropped} dropped (missing or implausible id, level, danger mark or position)`)
for (const r of rows) {
  const st = isStale(r.ts, now) ? 'STALE' : r.ts === null ? 'no timestamp' : 'fresh'
  console.log(`${r.id.padEnd(10)} ${r.name.padEnd(24)} level ${r.lvl.toFixed(2)} / danger ${r.danger.toFixed(2)}  margin ${(r.danger - r.lvl).toFixed(2)} m  ${st}`)
}
if (!rows.length) {
  console.log('Nothing usable. Check the paths in your map (list, id, lvl, ...) and units (scale).')
  process.exit(2)
}
if (rows.every((r) => r.ts === null)) console.log('Warning: no timestamps. Without them BaadhMitra cannot tell a frozen feed from a live one.')
