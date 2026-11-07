import { describe, expect, it } from 'vitest'
import { merge } from '../shared/score'
import type { Inc, Rep } from '../shared/types'
import { filt } from '../web/src/filter'

const rep = (place: string, needs: Rep['needs'], sev = 3): Rep => ({ place, lat: 25.6, lon: 85.1, depth: null, ppl: 4, needs, vul: false, sev, conf: 0.9, src: 'rule' })
const T0 = 1_700_000_000_000
const mk = (place: string, needs: Rep['needs'], t: number, sev = 3): Inc => merge(null, rep(place, needs, sev), 'r' + place, 'g' + place, t)

describe('queue search and filters', () => {
  const now = T0 + 2 * 3600_000
  const a = mk('Supaul', ['boat', 'food'], now - 3 * 3600_000, 5) // old, urgent: overdue
  const b = mk('Patna', ['water'], now - 60_000)
  const c = { ...mk('Gaya', ['medical'], now - 3 * 3600_000), status: 'assigned' as const, asg: now - 60_000 }
  const all = [a, b, c]

  it('keeps the ranked order and returns everything for an empty query', () => {
    expect(filt(all, '', 'all', now).map((x) => x.place)).toEqual(['Supaul', 'Patna', 'Gaya'])
  })
  it('matches place and need, ignoring case and spaces around', () => {
    expect(filt(all, '  SUPA ', 'all', now)).toEqual([a])
    expect(filt(all, 'medical', 'all', now)).toEqual([c])
  })
  it('overdue shows only incidents past the warning mark', () => {
    expect(filt(all, '', 'late', now)).toEqual([a])
  })
  it('unassigned hides incidents a crew already has', () => {
    expect(filt(all, '', 'free', now).map((x) => x.place)).toEqual(['Supaul', 'Patna'])
  })
  it('works with Devanagari place names', () => {
    const d = mk('सुपौल', ['food'], now)
    expect(filt([d, b], 'सुपौल', 'all', now)).toEqual([d])
  })
  it('combines a search with a filter', () => {
    expect(filt(all, 'patna', 'late', now)).toEqual([])
  })
})
