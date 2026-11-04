// Score the extractor on messages labelled by OTHER people.
//   npm run eval:ind -- labels-a.csv [labels-b.csv ...]
// One file: scores the extractor against it. Several files for the same messages: also reports how much the labelers agree
// with each other (the ceiling for any accuracy number) and scores against the first file.
// LLM=1 MODEL=<bedrock id> also scores the Bedrock model. Writes eval/independent/REPORT.md.
import { readFileSync, writeFileSync } from 'node:fs'
import { NEEDS, type Need, type Rep } from '../shared/types'
import { check, pick, prompt, rulex, SYS } from '../shared/extract'
import { locate } from '../shared/gazetteer'

export interface Lab {
  id: string
  t: string
  place: string | null // gazetteer name, or the raw text if the labeler named a place we do not know
  inGaz: boolean
  depth: number | null
  ppl: number | null
  needs: Need[]
  vul: boolean
  sev: number
  who: string
}

export function parseCsv(txt: string): string[][] {
  const out: string[][] = []
  let row: string[] = [], c = '', q = false
  const s = txt.replace(/^﻿/, '')
  for (let k = 0; k < s.length; k++) {
    const ch = s[k]
    if (q) {
      if (ch === '"') {
        if (s[k + 1] === '"') { c += '"'; k++ } else q = false
      } else c += ch
    } else if (ch === '"') q = true
    else if (ch === ',') { row.push(c); c = '' }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[k + 1] === '\n') k++
      row.push(c); c = ''
      if (row.some((x) => x !== '')) out.push(row)
      row = []
    } else c += ch
  }
  row.push(c)
  if (row.some((x) => x !== '')) out.push(row)
  return out
}

const num = (v: string | undefined): number | null => {
  const x = (v ?? '').trim()
  return x === '' || !Number.isFinite(Number(x)) ? null : Number(x)
}

export function toLabs(txt: string): Lab[] {
  const [h, ...rows] = parseCsv(txt)
  const ix = (n: string) => h.map((x) => x.trim().toLowerCase()).indexOf(n)
  const col = { id: ix('id'), t: ix('t'), place: ix('place'), depth: ix('depth'), ppl: ix('ppl'), needs: ix('needs'), vul: ix('vul'), sev: ix('sev'), who: ix('labeler') }
  if (col.t < 0 || col.sev < 0) throw new Error('CSV needs at least the columns t and sev')
  return rows.map((r, n) => {
    const pl = (r[col.place] ?? '').trim()
    const g = pl ? locate(pl) : null
    return {
      id: r[col.id] ?? String(n + 1),
      t: r[col.t],
      place: pl ? (g ? g.en : pl) : null,
      inGaz: pl === '' || g !== null,
      depth: num(r[col.depth]),
      ppl: num(r[col.ppl]),
      needs: (r[col.needs] ?? '').split('|').map((x) => x.trim()).filter((x): x is Need => (NEEDS as string[]).includes(x)),
      vul: /^(yes|true|1|y)$/i.test((r[col.vul] ?? '').trim()),
      sev: Number(r[col.sev]),
      who: (r[col.who] ?? '').trim() || 'anon',
    }
  })
}

/** 95% Wilson interval for a proportion. */
export function wilson(k: number, n: number): [number, number] {
  if (!n) return [0, 0]
  const z = 1.96, p = k / n, d = 1 + (z * z) / n
  const c = p + (z * z) / (2 * n)
  const m = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))
  return [Math.max(0, (c - m) / d), Math.min(1, (c + m) / d)]
}

export const band = (d: number | null): number | null => (d === null ? null : d <= 50 ? 0 : d <= 120 ? 1 : d <= 200 ? 2 : 3)

export interface Res { n: number; unusable: number; f: Record<string, [number, number]>; needs: { p: number; r: number; f1: number }; gazMiss: number }

export function scoreOne(labs: Lab[], preds: (Rep | null)[]): Res {
  const k: Record<string, number> = { place: 0, depth: 0, depthBand: 0, ppl: 0, vul: 0, sev1: 0, sevExact: 0 }
  let n = 0, unusable = 0, tp = 0, fp = 0, fn = 0, gazMiss = 0
  labs.forEach((l, i) => {
    const g = preds[i]
    if (!g) { unusable++; return }
    n++
    if (!l.inGaz) gazMiss++
    if (g.place === l.place) k.place++
    if (g.depth === l.depth) k.depth++
    if (band(g.depth) === band(l.depth)) k.depthBand++
    if (g.ppl === l.ppl) k.ppl++
    if (g.vul === l.vul) k.vul++
    if (Math.abs(g.sev - l.sev) <= 1) k.sev1++
    if (g.sev === l.sev) k.sevExact++
    for (const x of NEEDS) {
      const a = g.needs.includes(x), b = l.needs.includes(x)
      if (a && b) tp++
      else if (a) fp++
      else if (b) fn++
    }
  })
  const p = tp / Math.max(1, tp + fp), r = tp / Math.max(1, tp + fn)
  const f: Record<string, [number, number]> = {}
  for (const key of Object.keys(k)) f[key] = [k[key], n]
  return { n, unusable, f, needs: { p, r, f1: (2 * p * r) / Math.max(1e-9, p + r) }, gazMiss }
}

/** Agreement between two labelers on the same messages (matched by id). */
export function agree(a: Lab[], b: Lab[]): Record<string, [number, number]> {
  const m = new Map(b.map((x) => [x.id, x]))
  const k: Record<string, number> = { place: 0, depth: 0, ppl: 0, vul: 0, sev1: 0, needs: 0 }
  let n = 0
  for (const x of a) {
    const y = m.get(x.id)
    if (!y) continue
    n++
    if (x.place === y.place) k.place++
    if (x.depth === y.depth) k.depth++
    if (x.ppl === y.ppl) k.ppl++
    if (x.vul === y.vul) k.vul++
    if (Math.abs(x.sev - y.sev) <= 1) k.sev1++
    if ([...x.needs].sort().join() === [...y.needs].sort().join()) k.needs++
  }
  return Object.fromEntries(Object.keys(k).map((x) => [x, [k[x], n] as [number, number]]))
}

const pct = ([k, n]: [number, number]): string => {
  const [lo, hi] = wilson(k, n)
  return n ? `${((100 * k) / n).toFixed(1)}% (95% CI ${(100 * lo).toFixed(0)}-${(100 * hi).toFixed(0)}%)` : 'n/a'
}

export function report(name: string, labs: Lab[], r: Res): string {
  const who = [...new Set(labs.map((l) => l.who))].join(', ')
  const L = [`### ${name}`, '', `${r.n} messages scored, ${r.unusable} unusable. Labelled by: ${who}.`, '', '| Field | Score |', '| --- | --- |']
  const rows: [string, string][] = [['place (exact)', 'place'], ['people (exact)', 'ppl'], ['water depth (exact cm)', 'depth'], ['water depth (same band)', 'depthBand'], ['vulnerable person flagged', 'vul'], ['severity within 1', 'sev1'], ['severity exact', 'sevExact']]
  for (const [lab, key] of rows) L.push(`| ${lab} | ${pct(r.f[key])} |`)
  L.push(`| needs precision / recall / F1 | ${(100 * r.needs.p).toFixed(1)}% / ${(100 * r.needs.r).toFixed(1)}% / ${(100 * r.needs.f1).toFixed(1)}% |`, '')
  L.push(`Messages whose true place is not in the built-in gazetteer: ${r.gazMiss} of ${r.n} (${((100 * r.gazMiss) / Math.max(1, r.n)).toFixed(0)}%). The extractor cannot place these without a village dataset.`, '')
  return L.join('\n')
}

async function llm(text: string): Promise<Rep | null> {
  const { BedrockRuntimeClient, ConverseCommand } = await import('@aws-sdk/client-bedrock-runtime')
  const o = await new BedrockRuntimeClient({}).send(new ConverseCommand({ modelId: process.env.MODEL as string, system: [{ text: SYS }], messages: [{ role: 'user', content: [{ text: prompt(text) }] }], inferenceConfig: { maxTokens: 300, temperature: 0 } }))
  const b = o.output?.message?.content?.find((c) => 'text' in c) as { text?: string } | undefined
  return check(pick(b?.text ?? ''))
}

if (process.argv[1]?.endsWith('score.ts')) {
  const files = process.argv.slice(2)
  if (!files.length) {
    console.log('usage: npm run eval:ind -- labels.csv [second-labeler.csv]')
    process.exit(1)
  }
  const sets = files.map((f) => toLabs(readFileSync(f, 'utf-8')))
  const labs = sets[0]
  const out: string[] = ['# Independent accuracy report', '', `Generated ${new Date().toISOString().slice(0, 10)} from ${files.join(', ')}.`, '']
  if (labs.length < 100) out.push(`> **Too small to quote.** ${labs.length} messages is below the 100 recommended in \`eval/independent/LABELING.md\`; treat the numbers as a smoke test.`, '')
  out.push(report('Rule extractor (offline fallback)', labs, scoreOne(labs, labs.map((l) => rulex(l.t)))))
  if (process.env.LLM) {
    const preds: (Rep | null)[] = []
    for (const l of labs) preds.push(await llm(l.t).catch(() => null))
    out.push(report('Bedrock ' + process.env.MODEL, labs, scoreOne(labs, preds)))
  }
  if (sets.length > 1) {
    const a = agree(sets[0], sets[1])
    out.push('### Labeler agreement (first two files)', '', 'If two people disagree this much, no extractor can be expected to beat it.', '', '| Field | Agreement |', '| --- | --- |')
    for (const [k, v] of Object.entries(a)) out.push(`| ${k} | ${pct(v)} |`)
    out.push('')
  }
  const txt = out.join('\n')
  writeFileSync(new URL('./independent/REPORT.md', import.meta.url), txt)
  console.log(txt)
}
