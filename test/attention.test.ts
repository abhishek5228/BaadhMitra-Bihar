import { describe, expect, it } from 'vitest'
import { attention } from '../shared/attention'
import type { Gauge, Inc, Team } from '../shared/types'

const NOW = 1_800_000_000_000
const MIN = 60_000
const inc = (o: Partial<Inc>): Inc => ({ id: 'a', place: 'P', lat: 25, lon: 85, n: 1, raw: 1, sev: 3, ppl: 1, vul: false, needs: [], conf: 1, review: false, first: NOW - 5 * MIN, last: NOW, status: 'open', score: 50, snips: [], who: [], ver: 1, ...o })
const gauge = (o: Partial<Gauge>): Gauge => ({ id: 'g', name: 'G', river: 'R', lat: 25, lon: 85, lvl: 40, danger: 50, state: 'normal', trend: 0, ts: NOW, ...o })
const crew: Team = { id: 'T', lat: 25, lon: 85, ts: NOW - MIN }
const run = (o: Partial<Parameters<typeof attention>[0]>) => attention({ incs: [], gauges: [], teams: [crew], unplaced: 0, now: NOW, ...o })

describe('needs attention', () => {
  it('is empty when everything is fine', () => {
    expect(run({ incs: [inc({})], gauges: [gauge({})] })).toEqual([])
  })
  it('flags an unassigned incident past its limit and points at the most urgent one', () => {
    const a = inc({ id: 'old', first: NOW - 70 * MIN, score: 40 })
    const b = inc({ id: 'urgent', first: NOW - 40 * MIN, score: 90 })
    const r = run({ incs: [a, b] })
    expect(r[0]).toMatchObject({ kind: 'unassigned', lvl: 2, n: 2, ref: 'urgent' })
  })
  it('flags a crew gone silent, and a wait that is only a warning', () => {
    const silent = inc({ id: 's', status: 'assigned', asg: NOW - 130 * MIN, last: NOW - 130 * MIN, team: 'X' })
    const soon = inc({ id: 'w', first: NOW - 35 * MIN })
    const kinds = run({ incs: [silent, soon] }).map((i) => i.kind)
    expect(kinds).toEqual(['silent', 'soon'])
  })
  it('ignores closed incidents', () => {
    expect(run({ incs: [inc({ status: 'resolved', first: NOW - 500 * MIN })] })).toEqual([])
  })
  it('warns when open incidents have no crew with a recent position', () => {
    expect(run({ incs: [inc({})], teams: [] })[0]).toMatchObject({ kind: 'nocrew', lvl: 2 })
    expect(run({ incs: [inc({})], teams: [{ ...crew, ts: NOW - 90 * MIN }] })[0]).toMatchObject({ kind: 'nocrew' })
    expect(run({ incs: [], teams: [] })).toEqual([]) // nothing to dispatch, nothing to worry about
  })
  it('flags a river reaching its mark soon, but not a far-off one or a stale reading', () => {
    expect(run({ gauges: [gauge({ lvl: 49, trend: 0.6 })] })[0]).toMatchObject({ kind: 'rising', lvl: 2, hrs: 1.7 })
    expect(run({ gauges: [gauge({ lvl: 48, trend: 0.5 })] })[0]).toMatchObject({ kind: 'rising', lvl: 1, hrs: 4 })
    expect(run({ gauges: [gauge({ lvl: 45, trend: 0.5 })] })).toEqual([]) // 10 h away is outside the window
    expect(run({ gauges: [gauge({ lvl: 49, trend: 0.6, stale: true })] }).map((i) => i.kind)).toEqual(['stale'])
  })
  it('counts unplaced reports, reports needing a look and stale gauges, most serious first', () => {
    const r = run({ incs: [inc({ review: true })], gauges: [gauge({ stale: true })], unplaced: 3 })
    expect(r.map((i) => i.kind)).toEqual(['unplaced', 'review', 'stale'])
    expect(r[0].n).toBe(3)
  })
})

describe('needs attention: edges and robustness', () => {
  it('uses the overdue clock limits exactly: 60 min is overdue, 59 min 59 s is only a warning, under 30 min is fine', () => {
    expect(run({ incs: [inc({ first: NOW - 60 * MIN })] })[0]).toMatchObject({ kind: 'unassigned', lvl: 2 })
    expect(run({ incs: [inc({ first: NOW - 60 * MIN + 1000 })] })[0]).toMatchObject({ kind: 'soon', lvl: 1 })
    expect(run({ incs: [inc({ first: NOW - 29 * MIN })] })).toEqual([])
  })
  it('gives urgent incidents (score 75+) half the time', () => {
    expect(run({ incs: [inc({ score: 75, first: NOW - 15 * MIN })] })[0]).toMatchObject({ kind: 'soon' })
    expect(run({ incs: [inc({ score: 75, first: NOW - 30 * MIN })] })[0]).toMatchObject({ kind: 'unassigned' })
    expect(run({ incs: [inc({ score: 74, first: NOW - 15 * MIN })] })).toEqual([])
  })
  it('includes a river at exactly 6 hours and leaves out one just beyond', () => {
    expect(run({ gauges: [gauge({ lvl: 47, trend: 0.5 })] })[0]).toMatchObject({ kind: 'rising', hrs: 6 })
    expect(run({ gauges: [gauge({ lvl: 46.9, trend: 0.5 })] })).toEqual([])
  })
  it('marks a river act-now at 2 hours and look-at-it just after', () => {
    expect(run({ gauges: [gauge({ lvl: 49, trend: 0.5 })] })[0]).toMatchObject({ lvl: 2, hrs: 2 })
    expect(run({ gauges: [gauge({ lvl: 48.9, trend: 0.5 })] })[0]).toMatchObject({ lvl: 1, hrs: 2.2 })
  })
  it('reports the soonest of several rivers', () => {
    const r = run({ gauges: [gauge({ id: 'a', lvl: 47, trend: 0.5 }), gauge({ id: 'b', lvl: 49.5, trend: 0.5 })] })
    expect(r[0]).toMatchObject({ kind: 'rising', n: 2, hrs: 1 })
  })
  it('a crew position from the future or a missing one does not count as recent', () => {
    expect(run({ incs: [inc({})], teams: [{ ...crew, ts: 0 }] })[0]).toMatchObject({ kind: 'nocrew' })
  })
  it('says nothing about crews when the crew list could not be loaded', () => {
    expect(run({ incs: [inc({})], teams: null })).toEqual([])
  })
  it('does not change what it is given', () => {
    const incs = [inc({ first: NOW - 90 * MIN }), inc({ id: 'b', first: NOW - 40 * MIN })]
    const before = JSON.stringify(incs)
    run({ incs })
    expect(JSON.stringify(incs)).toBe(before)
  })
  it('never throws and always returns sorted, well-formed issues, whatever the data looks like', () => {
    let s = 7
    const r = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32)
    const kinds = new Set(['unassigned', 'silent', 'soon', 'nocrew', 'rising', 'unplaced', 'review', 'stale'])
    for (let k = 0; k < 300; k++) {
      const incs = Array.from({ length: Math.floor(r() * 8) }, (_, j) =>
        inc({ id: 'i' + j, status: (['open', 'assigned', 'resolved', 'dismissed'] as const)[Math.floor(r() * 4)], score: Math.floor(r() * 101), first: NOW - Math.floor(r() * 300) * MIN, last: NOW - Math.floor(r() * 300) * MIN, asg: r() < 0.5 ? NOW - Math.floor(r() * 300) * MIN : undefined, review: r() < 0.3 }),
      )
      const gauges = Array.from({ length: Math.floor(r() * 5) }, (_, j) => gauge({ id: 'g' + j, lvl: 30 + r() * 25, danger: 40 + r() * 15, trend: r() < 0.2 ? NaN : r() * 1.2 - 0.3, stale: r() < 0.2 }))
      const teams = Array.from({ length: Math.floor(r() * 4) }, (_, j) => ({ ...crew, id: 't' + j, ts: r() < 0.3 ? 0 : NOW - Math.floor(r() * 120) * MIN }))
      const out = run({ incs, gauges, teams, unplaced: Math.floor(r() * 3) })
      for (let j = 0; j < out.length; j++) {
        expect(kinds.has(out[j].kind)).toBe(true)
        expect(out[j].n).toBeGreaterThan(0)
        if (j) expect(out[j - 1].lvl).toBeGreaterThanOrEqual(out[j].lvl)
        if (out[j].ref) expect(incs.some((i) => i.id === out[j].ref)).toBe(true)
      }
      expect(new Set(out.map((o) => o.kind)).size).toBe(out.length) // one entry per kind
    }
  })
})
