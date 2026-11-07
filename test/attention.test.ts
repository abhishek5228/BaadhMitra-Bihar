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
