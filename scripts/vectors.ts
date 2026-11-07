// Writes conformance/vectors.json: inputs and the answers the TypeScript code gives for them.
// The C# port in dotnet/ must reproduce every answer, so the two implementations cannot drift apart silently.
//   npm run vectors
import { writeFileSync } from 'node:fs'
import { score } from '../shared/score'
import { q, sla } from '../shared/sla'
import { gcent, ghash } from '../shared/geo'
import { suggest } from '../shared/suggest'
import { hoursToDanger } from '../shared/trend'
import type { Inc, Team } from '../shared/types'

// Tiny seeded generator so the file is identical on every run (a diff then means the logic changed).
let st = 20261107
const rnd = (): number => {
  st = (Math.imul(st, 1664525) + 1013904223) >>> 0
  return st / 2 ** 32
}
const pick = <T,>(a: T[]): T => a[Math.floor(rnd() * a.length)]
const int = (lo: number, hi: number): number => lo + Math.floor(rnd() * (hi - lo + 1))
const NOW = 1_800_000_000_000
const HR = 3_600_000

const scoreCases = Array.from({ length: 700 }, () => {
  const needs = pick([[], ['medical'], ['boat'], ['food', 'medical'], ['boat', 'water']])
  const i = { sev: int(1, 5), n: pick([1, 2, 3, 4, 5, 8, 15, 40, 120]), ppl: pick([0, 1, 3, 4, 7, 10, 25, 40, 200, 999]), vul: rnd() < 0.4, needs, last: NOW - Math.floor(rnd() * 120 * HR), status: pick(['open', 'open', 'open', 'assigned', 'resolved', 'dismissed']) } as Pick<Inc, 'sev' | 'n' | 'ppl' | 'vul' | 'needs' | 'last' | 'status'>
  return { in: i, now: NOW, out: score(i, NOW) }
})

// edges: log2 at exact powers, ppl cap, the 24 h decay point, the 35% decay ceiling
for (const [n, ppl, ageH, status] of [[1, 0, 0, 'open'], [3, 40, 24, 'open'], [7, 41, 48, 'open'], [15, 1000, 200, 'assigned'], [0, 0, 0, 'open']] as const) {
  const i = { sev: 3, n, ppl, vul: false, needs: [] as string[], last: NOW - ageH * HR, status } as Pick<Inc, 'sev' | 'n' | 'ppl' | 'vul' | 'needs' | 'last' | 'status'>
  scoreCases.push({ in: i, now: NOW, out: score(i, NOW) })
}

const maybe = (v: number): number | null => (rnd() < 0.4 ? null : v)
const slaCases = Array.from({ length: 600 }, () => {
  const first = NOW - int(0, 300) * 60_000 - int(0, 59_999)
  const i = {
    status: pick(['open', 'open', 'assigned', 'assigned', 'resolved', 'dismissed']),
    score: pick([0, 20, 60, 74, 75, 76, 90, 100]),
    first,
    opn: maybe(first + int(0, 60) * 60_000),
    asg: maybe(first + int(1, 90) * 60_000),
    fts: maybe(first + int(1, 200) * 60_000),
    last: first + int(0, 100) * 60_000,
  }
  const inc = { ...i, opn: i.opn ?? undefined, asg: i.asg ?? undefined, fts: i.fts ?? undefined } as unknown as Pick<Inc, 'status' | 'score' | 'first' | 'opn' | 'asg' | 'fts' | 'last'>
  return { in: i, now: NOW, out: sla(inc, NOW) }
})

// edges: exactly at the warn and breach minute, one millisecond short, urgent (75) vs not (74)
for (const [status, sc, waitMs] of [['open', 74, 30 * 60_000], ['open', 74, 30 * 60_000 - 1], ['open', 75, 15 * 60_000], ['open', 75, 30 * 60_000], ['open', 74, 60 * 60_000], ['assigned', 10, 60 * 60_000], ['assigned', 10, 120 * 60_000 - 1], ['assigned', 10, 120 * 60_000]] as const) {
  const first = NOW - waitMs
  const i = { status, score: sc, first, opn: null as number | null, asg: null as number | null, fts: null as number | null, last: first }
  const inc = { ...i, opn: undefined, asg: undefined, fts: undefined } as unknown as Pick<Inc, 'status' | 'score' | 'first' | 'opn' | 'asg' | 'fts' | 'last'>
  slaCases.push({ in: i as (typeof slaCases)[number]['in'], now: NOW, out: sla(inc, NOW) })
}

const trendCases = Array.from({ length: 300 }, () => {
  const lvl = Math.round((20 + rnd() * 35) * 100) / 100
  const danger = Math.round((30 + rnd() * 25) * 100) / 100
  const trend = Math.round((rnd() * 1.6 - 0.5) * 100) / 100
  const stale = rnd() < 0.1
  return { in: { lvl, danger, trend, stale }, out: hoursToDanger({ lvl, danger, trend, stale }) }
})
// the edges that matter: exactly the noise floor, exactly at the mark, exactly 48 h out
for (const [lvl, danger, trend] of [[45, 50, 0.02], [50, 50, 0.5], [49.99, 50, 0.5], [40, 49.6, 0.2], [30, 50, 0.4166]] as const) trendCases.push({ in: { lvl, danger, trend, stale: false }, out: hoursToDanger({ lvl, danger, trend, stale: false }) })

const suggestCases = Array.from({ length: 120 }, () => {
  const inc = { lat: 25 + rnd() * 2, lon: 84 + rnd() * 4 }
  const teams: Team[] = Array.from({ length: int(0, 6) }, (_, k) => ({
    id: 'T' + k,
    lat: rnd() < 0.08 ? NaN : inc.lat + (rnd() - 0.5) * 0.9,
    lon: inc.lon + (rnd() - 0.5) * 0.9,
    ts: rnd() < 0.08 ? 0 : NOW - int(0, 180) * 60_000,
    busy: rnd() < 0.3,
  }))
  const max = pick([1, 2, 3, 3, 3, 5])
  const wire = teams.map((t) => ({ id: t.id, lat: Number.isFinite(t.lat) ? t.lat : null, lon: t.lon, ts: t.ts, busy: !!t.busy }))
  return { in: { inc, teams: wire, max }, now: NOW, out: suggest(inc, teams, NOW, max) }
})

const geoCases = Array.from({ length: 300 }, () => {
  const lat = Math.round((24.2 + rnd() * 3.4) * 1e6) / 1e6
  const lon = Math.round((83.2 + rnd() * 5.2) * 1e6) / 1e6
  const prec = pick([4, 5, 5, 5, 6, 7])
  const h = ghash(lat, lon, prec)
  return { in: { lat, lon, prec }, out: { hash: h, ...gcent(h) } }
})
// cell edges: exactly on a boundary, and the four corners of the world
for (const [lat, lon] of [[0, 0], [90, 180], [-90, -180], [25.5, 85.0], [25.0, 85.0]] as const) geoCases.push({ in: { lat, lon, prec: 5 }, out: { hash: ghash(lat, lon, 5), ...gcent(ghash(lat, lon, 5)) } })

const pctCases = Array.from({ length: 150 }, () => {
  const a = Array.from({ length: int(0, 12) }, () => Math.round(rnd() * 3000) / 10)
  const p = pick([0, 0.5, 0.9, 0.99, 1])
  return { in: { p, a }, out: q(a, p) }
})

// edges: no crews at all, two crews at the same spot (order must stay as given), a crew whose only fix is 0
{
  const inc = { lat: 25.6, lon: 85.1 }
  const same = [{ id: 'A', lat: 25.7, lon: 85.2, ts: NOW - 60_000, busy: false }, { id: 'B', lat: 25.7, lon: 85.2, ts: NOW - 60_000, busy: false }, { id: 'C', lat: 25.7, lon: 85.2, ts: 0, busy: false }]
  for (const teams of [[], same]) suggestCases.push({ in: { inc, teams, max: 3 }, now: NOW, out: suggest(inc, teams as Team[], NOW, 3) })
}

writeFileSync(new URL('../conformance/vectors.json', import.meta.url), JSON.stringify({ note: 'Generated by scripts/vectors.ts from the TypeScript implementation. Do not edit by hand.', score: scoreCases, sla: slaCases, trend: trendCases, suggest: suggestCases, geo: geoCases, pct: pctCases }, null, 1) + '\n')
// Flat tab-separated copy for languages without a JSON reader in their standard library.
const f = (v: unknown): string => (v === null || v === undefined ? '-' : v === true ? '1' : v === false ? '0' : String(v))
const rows: string[] = []
for (const c of scoreCases) rows.push(['score', c.in.sev, c.in.n, c.in.ppl, f(c.in.vul), c.in.needs.join(',') || '-', c.in.last, c.in.status, c.now, c.out].map(f).join('\t'))
for (const c of slaCases) rows.push(['sla', c.in.status, c.in.score, c.in.first, c.in.opn, c.in.asg, c.in.fts, c.in.last, c.now, c.out.lvl, c.out.why, c.out.mins].map(f).join('\t'))
for (const c of trendCases) rows.push(['trend', c.in.lvl, c.in.danger, c.in.trend, c.in.stale, c.out].map(f).join('\t'))
for (const c of suggestCases) {
  const t = c.in.teams.map((x) => [x.id, f(x.lat), x.lon, x.ts, f(x.busy)].join(',')).join(';') || '-'
  const o = c.out.map((x) => [x.id, x.km, x.eta, f(x.busy), f(x.stale)].join(',')).join(';') || '-'
  rows.push(['suggest', c.in.inc.lat, c.in.inc.lon, c.now, c.in.max, t, o].map(f).join('\t'))
}
for (const c of geoCases) rows.push(['geo', c.in.lat, c.in.lon, c.in.prec, c.out.hash, c.out.lat, c.out.lon].map(f).join('\t'))
for (const c of pctCases) rows.push(['pct', c.in.p, c.in.a.join(',') || '-', c.out].map(f).join('\t'))
writeFileSync(new URL('../conformance/vectors.tsv', import.meta.url), rows.join('\n') + '\n')
console.log(`vectors: ${scoreCases.length} score, ${slaCases.length} sla, ${trendCases.length} trend, ${suggestCases.length} suggest, ${geoCases.length} geohash, ${pctCases.length} percentile`)
