import { describe, expect, it } from 'vitest'
import { merge } from '../shared/score'
import type { Rep } from '../shared/types'
import { cell, COLS, toCsv } from '../web/src/csv'

const rep = (place: string): Rep => ({ place, lat: 25.6, lon: 85.1, depth: null, ppl: 4, needs: ['food', 'boat'], vul: true, sev: 3, conf: 0.9, src: 'rule' })

describe('incident CSV export', () => {
  it('quotes commas, quotes and newlines', () => {
    expect(cell('a,b')).toBe('"a,b"')
    expect(cell('say "hi"')).toBe('"say ""hi"""')
    expect(cell('x\ny')).toBe('"x\ny"')
    expect(cell(null)).toBe('')
  })
  it('defuses spreadsheet formulas that come from citizen text', () => {
    for (const bad of ['=HYPERLINK("http://evil")', '+1+1', '-2', '@SUM(A1)']) expect(cell(bad).replace(/^"/, '')).toMatch(/^'/)
    expect(cell('Patna')).toBe('Patna')
  })
  it('writes one header and one line per incident with the same column count', () => {
    const i = merge(null, rep('Supaul'), 'r1', 'g1', 1_700_000_000_000)
    const lines = toCsv([i, merge(null, rep('=cmd'), 'r2', 'g2', 1_700_000_000_000)], 1_700_000_100_000).replace('\ufeff', '').trim().split('\r\n')
    expect(lines).toHaveLength(3)
    expect(lines[0].split(',')).toHaveLength(COLS.length)
    expect(lines[1]).toContain('Supaul')
    expect(lines[1]).toContain('food|boat')
    expect(lines[2]).toContain("'=cmd")
  })
  it('never exports reporter ids', () => {
    const i = merge(null, rep('Patna'), 'secret-reporter', 'g1', 1_700_000_000_000)
    expect(toCsv([i], 1_700_000_100_000)).not.toContain('secret-reporter')
  })
})
