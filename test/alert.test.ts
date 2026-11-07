import { describe, expect, it } from 'vitest'
import { atext, grank, gstate } from '../shared/alert'
import type { Gauge } from '../shared/types'

const g = (o: Partial<Gauge>): Gauge => ({ id: 'g', name: 'Hajipur', river: 'Gandak', lat: 25.7, lon: 85.2, lvl: 49.65, danger: 50.3, state: 'warn', trend: 0.4, ts: 0, ...o })

describe('gauge state', () => {
  it('is normal more than 1 m below the danger mark, warn within 1 m, danger at or above it', () => {
    expect(gstate(48.0, 50)).toBe('normal')
    expect(gstate(49.0, 50)).toBe('warn') // exactly 1 m below
    expect(gstate(48.99, 50)).toBe('normal')
    expect(gstate(49.99, 50)).toBe('warn')
    expect(gstate(50, 50)).toBe('danger')
    expect(gstate(53, 50)).toBe('danger')
  })
  it('ranks states so an escalation is a bigger number', () => {
    expect(grank.normal).toBeLessThan(grank.warn)
    expect(grank.warn).toBeLessThan(grank.danger)
  })
})

describe('alert wording', () => {
  it('a warning names the river and place, the level, and the gap below the mark, in both languages', () => {
    const t = atext(g({}))
    expect(t.en).toBe('Flood warning: Gandak at Hajipur is 49.65 m, 0.65 m below the danger level. Prepare to move.')
    expect(t.hi).toContain('Hajipur')
    expect(t.hi).toContain('49.65')
    expect(t.hi).toContain('0.65')
    expect(t.hi).toContain('चेतावनी')
  })
  it('a danger alert says how far above the mark and tells people to move now', () => {
    const t = atext(g({ state: 'danger', lvl: 51.1 }))
    expect(t.en).toContain('0.80 m above the danger level')
    expect(t.en).toContain('Move to higher ground now')
    expect(t.hi).toContain('0.80')
    expect(t.hi).toContain('ऊँची जगह')
  })
  it('keeps two decimals, so a reading of 49.5 is written 49.50', () => {
    expect(atext(g({ lvl: 49.5, danger: 50 })).en).toContain('49.50 m, 0.50 m below')
  })
  it('never prints a negative gap', () => {
    expect(atext(g({ state: 'danger', lvl: 50, danger: 50 })).en).toContain('0.00 m above')
    expect(atext(g({ state: 'warn', lvl: 51, danger: 50 })).en).not.toContain('-')
  })
  it('keeps every sentence short enough to be read aloud', () => {
    for (const s of [atext(g({})), atext(g({ state: 'danger', lvl: 51 }))])
      for (const line of [s.en, s.hi]) for (const sentence of line.split(/[.।]/)) expect(sentence.trim().length).toBeLessThan(140)
  })
})
