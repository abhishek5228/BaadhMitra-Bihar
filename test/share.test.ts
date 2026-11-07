import { describe, expect, it } from 'vitest'
import { brief, mapLink, waLink } from '../web/src/share'

const inc = { id: 'tuw9e', place: 'Supaul', lat: 26.12345678, lon: 86.60123456, score: 86, ppl: 20, vul: true, needs: ['boat', 'medical'] as ('boat' | 'medical')[], n: 3 }

describe('sharing an incident with a crew', () => {
  it('links to the exact spot with five decimals (about a metre)', () => {
    expect(mapLink(26.12345678, 86.60123456)).toBe('https://www.google.com/maps/search/?api=1&query=26.12346,86.60123')
  })
  it('writes a short English brief with the facts a crew needs', () => {
    const t = brief(inc, 'en')
    expect(t).toContain('Rescue: Supaul (priority 86/100)')
    expect(t).toContain('People at risk: 20')
    expect(t).toContain('Children / elderly / sick present')
    expect(t).toContain('Needs: boat, medical help')
    expect(t).toContain('https://www.google.com/maps/search/?api=1&query=26.12346,86.60123')
    expect(t.split('\n').length).toBeLessThanOrEqual(7)
  })
  it('writes the same brief in Hindi', () => {
    const t = brief(inc, 'hi')
    expect(t).toContain('बचाव: Supaul')
    expect(t).toContain('ज़रूरत: नाव, इलाज/दवा')
    expect(t).toContain('google.com/maps')
  })
  it('leaves out lines that have nothing to say', () => {
    const t = brief({ ...inc, ppl: 0, vul: false, needs: [] }, 'en')
    expect(t).not.toContain('People at risk')
    expect(t).not.toContain('elderly')
    expect(t).not.toContain('Needs:')
  })
  it('carries only the structured fields: no message text and no sender ids', () => {
    const t = brief({ ...inc, snips: [{ t: 'call me on 98765 43210' }], who: ['abc'] } as never, 'en')
    expect(t).not.toContain('98765')
    expect(t).not.toContain('abc')
  })
  it('builds a WhatsApp link with the text safely encoded', () => {
    const t = brief(inc, 'en')
    const u = waLink(t)
    expect(u.startsWith('https://wa.me/?text=')).toBe(true)
    expect(decodeURIComponent(u.slice('https://wa.me/?text='.length))).toBe(t)
    expect(u).not.toContain('\n')
  })
})
