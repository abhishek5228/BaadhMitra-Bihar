import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { CWC_BIHAR, ref, stationTable } from '../shared/cwc'
import { STATIONS } from '../shared/stations'
import { adapt, isStale, normalize, type FeedMap } from '../backend/lib/feed'
import { gstate } from '../shared/alert'

describe('the daily bulletin feed file', () => {
  const golden = JSON.parse(readFileSync('test/fixtures/cwc/2024-09-03.expected.json', 'utf8')) as unknown[]
  it('is what the poller accepts: 17 Bihar stations, none dropped, none marked simulated', () => {
    const { rows, dropped } = normalize(golden)
    expect(dropped).toBe(0)
    expect(rows).toHaveLength(17)
    expect(rows.every((r) => r.sim === false && r.ts === 1725352200000)).toBe(true)
  })
  it('carries the states the bulletin printed: Baltara, Benibad and Dumariaghat above danger, Basua only above warning', () => {
    const by = Object.fromEntries(normalize(golden).rows.map((r) => [r.id, r]))
    expect(gstate(by.baltara.lvl, by.baltara.danger)).toBe('danger')
    expect(gstate(by.benibad.lvl, by.benibad.danger)).toBe('danger')
    expect(gstate(by.dumariaghat.lvl, by.dumariaghat.danger)).toBe('danger')
    expect(gstate(by.basua.lvl, by.basua.danger)).toBe('warn')
  })
  it('is stale after a day for the default 3 h window and fresh for a 30 h one', () => {
    const ts = 1725352200000
    expect(isStale(ts, ts + 20 * 3600_000)).toBe(true)
    expect(isStale(ts, ts + 20 * 3600_000, 30 * 3600_000)).toBe(false)
    expect(isStale(ts, ts + 31 * 3600_000, 30 * 3600_000)).toBe(true)
  })
})

describe('official CWC reference levels', () => {
  it('lists each station once, with plausible marks', () => {
    expect(new Set(CWC_BIHAR.map((r) => r.id)).size).toBe(CWC_BIHAR.length)
    expect(CWC_BIHAR.length).toBe(18)
    for (const r of CWC_BIHAR) {
      expect(r.warn).toBeLessThan(r.danger)
      if (r.hfl !== null) expect(r.hfl).toBeGreaterThan(r.danger)
      expect(r.lat).toBeGreaterThan(24)
      expect(r.lat).toBeLessThan(28)
      expect(r.lon).toBeGreaterThan(83)
      expect(r.lon).toBeLessThan(89)
    }
  })
  it('puts every warning mark exactly 1 m under its danger mark, which is the rule our gauge state already uses', () => {
    for (const r of CWC_BIHAR) expect(Math.round((r.danger - r.warn) * 100) / 100).toBe(1)
    const r = ref('basua')
    expect(gstate(r.warn - 0.01, r.danger)).toBe('normal')
    expect(gstate(r.warn, r.danger)).toBe('warn')
    expect(gstate(r.danger, r.danger)).toBe('danger')
  })
  it('refuses an unknown station instead of inventing a mark', () => {
    expect(() => ref('nowhere')).toThrow()
  })
  it('gives the demo stations the official danger marks', () => {
    for (const s of STATIONS) expect(s.danger).toBe(ref(s.id).danger)
    expect(ref('baltara').danger).toBe(33.85)
    expect(ref('kursela').river).toBe('Kosi')
  })
  it('keeps the published JSON table in step with the code', () => {
    const doc = JSON.parse(readFileSync('docs/cwc-bihar-stations.json', 'utf8')) as { stations: unknown }
    expect(doc.stations).toEqual(stationTable())
  })
  it('turns a feed that only has codes and levels into full readings, using the official marks', () => {
    const map: FeedMap = { list: 'readings', id: 'code', lvl: 'level', ts: 'at', stations: stationTable() }
    const feed = { readings: [{ code: 'basua', level: 47.9, at: 1_800_000_000_000 }, { code: 'unknown', level: 12, at: 1_800_000_000_000 }] }
    const { rows, dropped } = normalize(adapt(feed, map))
    expect(rows).toHaveLength(1)
    expect(dropped).toBe(1)
    expect(rows[0]).toMatchObject({ id: 'basua', river: 'Kosi', danger: 47.75, lvl: 47.9, sim: false })
    expect(gstate(rows[0].lvl, rows[0].danger)).toBe('danger')
  })
})
