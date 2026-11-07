import { describe, expect, it } from 'vitest'
import { suggest, BUSY_PENALTY, FRESH_MS } from '../shared/suggest'
import { hoursToDanger, MAX_HOURS } from '../shared/trend'
import type { Team } from '../shared/types'

const now = 1_700_000_000_000
const inc = { lat: 26.0, lon: 86.5 }
const km = (d: number) => d / 111 // degrees of latitude for d km
const team = (id: string, dKm: number, o: Partial<Team> = {}): Team => ({ id, lat: inc.lat + km(dKm), lon: inc.lon, ts: now - 60_000, ...o })

describe('team suggestion', () => {
  it('puts the nearest free crew first with distance and time', () => {
    const r = suggest(inc, [team('far', 30), team('near', 5), team('mid', 12)], now)
    expect(r.map((x) => x.id)).toEqual(['near', 'mid', 'far'])
    expect(r[0].km).toBeCloseTo(5, 0)
    expect(r[0].eta).toBeCloseTo(15, 0) // 5 km at 20 km/h
  })
  it('prefers a free crew over a slightly closer busy one, but a much closer busy one can win', () => {
    expect(suggest(inc, [team('busy', 4, { busy: true }), team('free', 8)], now)[0].id).toBe('free')
    expect(suggest(inc, [team('busy', 1, { busy: true }), team('free', 40)], now)[0].id).toBe('busy')
    expect(BUSY_PENALTY).toBeGreaterThan(0)
  })
  it('marks old positions and charges for them', () => {
    const old = suggest(inc, [team('old', 5, { ts: now - 2 * FRESH_MS })], now)[0]
    const fresh = suggest(inc, [team('new', 5)], now)[0]
    expect(old.stale).toBe(true)
    expect(old.eta).toBeGreaterThan(fresh.eta)
  })
  it('leaves out crews with no position and respects the limit', () => {
    const noPos = { id: 'x', lat: NaN, lon: NaN, ts: 0 } as Team
    expect(suggest(inc, [noPos], now)).toEqual([])
    expect(suggest(inc, [team('a', 1), team('b', 2), team('c', 3), team('d', 4)], now, 2)).toHaveLength(2)
  })
})

describe('time to danger', () => {
  const g = (o: object) => ({ lvl: 45, danger: 50, trend: 0.5, stale: false, ...o })
  it('divides the gap by the rate', () => expect(hoursToDanger(g({}))).toBe(10))
  it('is null when falling, flat, noisy, stale or already over', () => {
    for (const o of [{ trend: -0.3 }, { trend: 0 }, { trend: 0.01 }, { stale: true }, { lvl: 51 }]) expect(hoursToDanger(g(o))).toBeNull()
  })
  it('does not promise a time beyond two days', () => {
    expect(hoursToDanger(g({ lvl: 20, trend: 0.1 }))).toBeNull()
    expect(MAX_HOURS).toBe(48)
  })
})
