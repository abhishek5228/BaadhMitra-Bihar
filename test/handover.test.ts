import { describe, expect, it } from 'vitest'
import { sheet, sheetEl, type Labels } from '../web/src/handover'
import type { Gauge, Inc, Team } from '../shared/types'

// @vitest-environment jsdom
const NOW = 1_800_000_000_000
const MIN = 60_000
const inc = (id: string, o: Partial<Inc> = {}): Inc => ({ id, place: id, lat: 25, lon: 85, n: 1, raw: 1, sev: 3, ppl: 1, vul: false, needs: [], conf: 1, review: false, first: NOW - 5 * MIN, last: NOW, status: 'open', score: 50, snips: [], who: [], ver: 1, ...o })
const gauge = (o: Partial<Gauge>): Gauge => ({ id: 'g', name: 'G', river: 'R', lat: 25, lon: 85, lvl: 40, danger: 50, state: 'normal', trend: 0, ts: NOW, ...o })

describe('handover sheet', () => {
  it('lists open and assigned incidents, most urgent first, and drops closed ones', () => {
    const s = sheet([inc('low', { score: 30 }), inc('high', { score: 90 }), inc('gone', { status: 'resolved', score: 99 }), inc('no', { status: 'dismissed' }), inc('mid', { score: 60, status: 'assigned', team: 'NDRF A', asg: NOW - 10 * MIN })], [], [], NOW)
    expect(s.rows.map((r) => r.place)).toEqual(['high', 'mid', 'low'])
    expect(s).toMatchObject({ open: 2, assigned: 1 })
    expect(s.rows[1]).toMatchObject({ status: 'assigned', team: 'NDRF A' })
  })
  it('breaks a tie on score by who has waited longest', () => {
    const s = sheet([inc('new', { first: NOW - 5 * MIN }), inc('old', { first: NOW - 25 * MIN })], [], [], NOW)
    expect(s.rows.map((r) => r.place)).toEqual(['old', 'new'])
  })
  it('counts overdue ones and marks why', () => {
    const s = sheet([inc('slow', { first: NOW - 70 * MIN })], [], [], NOW)
    expect(s.late).toBe(1)
    expect(s.rows[0]).toMatchObject({ lvl: 2, why: 'unassigned', waited: 70 })
  })
  it('lists crews busy first, with minutes since their last position, and "never" for none', () => {
    const t: Team[] = [{ id: 'B', lat: 25, lon: 85, ts: NOW - 4 * MIN }, { id: 'A', lat: 25, lon: 85, ts: 0, busy: true }, { id: 'C', lat: 25, lon: 85, ts: NOW - 125 * MIN, busy: true }]
    const s = sheet([], t, [], NOW)
    expect(s.crews).toEqual([{ id: 'A', busy: true, seen: null }, { id: 'C', busy: true, seen: 125 }, { id: 'B', busy: false, seen: 4 }])
  })
  it('lists only rivers near or over the mark, or rising to it soon, and never a stale reading', () => {
    const s = sheet([], [], [gauge({ id: 'calm', name: 'Calm' }), gauge({ name: 'Warn', state: 'warn', lvl: 49.5 }), gauge({ name: 'Rising', lvl: 48, trend: 0.5 }), gauge({ name: 'Far', lvl: 45, trend: 0.5 }), gauge({ name: 'Old', state: 'danger', lvl: 51, stale: true })], NOW)
    expect(s.rivers.map((r) => r.name)).toEqual(['Warn', 'Rising'])
    expect(s.rivers[1].hrs).toBe(4)
  })
  it('flags a simulated reading', () => {
    expect(sheet([], [], [gauge({ state: 'warn', lvl: 49.5, sim: true })], NOW).rivers[0].sim).toBe(true)
  })
})

const L: Labels = { title: 'Handover', prepared: 'Prepared', open: 'Open', assigned: 'Assigned', late: 'overdue', incidents: 'Incidents', place: 'Place', prio: 'Priority', status: 'Status', team: 'Team', waited: 'Waiting', people: 'People', needs: 'Needs', crews: 'Crews', seen: 'Last position', never: 'never', busy: 'busy', free: 'free', rivers: 'Rivers', level: 'Level', mark: 'Danger', rising: 'To danger', sim: 'simulated', none: 'None', mins: 'min', sign: 'Sign', by: 'Handed over by', to: 'Received by', notes: 'Notes', why: { unassigned: 'no team', silent: 'no update' }, need: { boat: 'boat', food: 'food', water: 'water', medical: 'medical', shelter: 'shelter' }, vul: 'vulnerable' }

describe('handover sheet as a page', () => {
  it('shows a table row per incident and the signature lines', () => {
    const s = sheet([inc('Supaul', { score: 86, ppl: 20, vul: true, needs: ['boat'], first: NOW - 70 * MIN })], [], [], NOW)
    const el = sheetEl(s, L, 'officer@example.gov.in')
    expect(el.querySelectorAll('tbody tr')).toHaveLength(1)
    expect(el.textContent).toContain('Supaul')
    expect(el.textContent).toContain('⏰ no team')
    expect(el.textContent).toContain('20 ⚠ vulnerable')
    expect(el.textContent).toContain('officer@example.gov.in')
    expect(el.textContent).toContain('Handed over by')
    expect(el.textContent).toContain('Received by')
  })
  it('says None for an empty section instead of an empty table', () => {
    const el = sheetEl(sheet([], [], [], NOW), L, '')
    expect(el.querySelectorAll('table')).toHaveLength(0)
    expect(el.textContent?.match(/None/g)).toHaveLength(3)
  })
  it('puts place names in as text, never as markup', () => {
    const el = sheetEl(sheet([inc('<img src=x onerror=alert(1)>')], [], [], NOW), L, '')
    expect(el.querySelector('img')).toBeNull()
    expect(el.textContent).toContain('<img src=x')
  })
})
