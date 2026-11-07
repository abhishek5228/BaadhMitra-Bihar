// Shift handover sheet: what the next control-room shift must know, on paper. Control rooms keep paper logs, and a
// printed sheet still works when the screen, the network or the power does not.
import type { Gauge, Inc, Need, Team } from '../../shared/types'
import { sla } from '../../shared/sla'
import { hoursToDanger } from '../../shared/trend'

export interface Row {
  place: string
  score: number
  status: 'open' | 'assigned'
  team: string
  waited: number // minutes in the current wait
  why: 'unassigned' | 'silent' | null
  lvl: 0 | 1 | 2
  ppl: number
  vul: boolean
  needs: Need[]
}
export interface CrewRow {
  id: string
  busy: boolean
  seen: number | null // minutes since its last position, null if it never shared one
}
export interface RiverRow {
  name: string
  river: string
  lvl: number
  danger: number
  trend: number
  hrs: number | null
  sim: boolean
}
export interface Sheet {
  at: number
  open: number
  assigned: number
  late: number
  rows: Row[]
  crews: CrewRow[]
  rivers: RiverRow[]
}

/** Rivers worth putting on paper: within a metre of the mark or above it, or rising to it within this many hours. */
export const RIVER_HOURS = 6

export function sheet(incs: Inc[], teams: Team[], gauges: Gauge[], now: number): Sheet {
  const rows: Row[] = incs
    .filter((i): i is Inc & { status: 'open' | 'assigned' } => i.status === 'open' || i.status === 'assigned')
    .map((i) => {
      const s = sla(i, now)
      return { place: i.place, score: i.score, status: i.status, team: i.team ?? '', waited: s.mins, why: s.why, lvl: s.lvl, ppl: i.ppl, vul: i.vul, needs: i.needs }
    })
    .sort((a, b) => b.score - a.score || b.waited - a.waited)
  const crews: CrewRow[] = teams
    .map((t) => ({ id: t.id, busy: !!t.busy, seen: t.ts ? Math.max(0, Math.floor((now - t.ts) / 60_000)) : null }))
    .sort((a, b) => Number(b.busy) - Number(a.busy) || a.id.localeCompare(b.id))
  const rivers: RiverRow[] = gauges
    .map((g) => ({ g, hrs: hoursToDanger(g) }))
    .filter(({ g, hrs }) => !g.stale && (g.state !== 'normal' || (hrs !== null && hrs <= RIVER_HOURS)))
    .map(({ g, hrs }) => ({ name: g.name, river: g.river, lvl: g.lvl, danger: g.danger, trend: g.trend, hrs, sim: !!g.sim }))
    .sort((a, b) => b.lvl - b.danger - (a.lvl - a.danger))
  return { at: now, open: rows.filter((r) => r.status === 'open').length, assigned: rows.filter((r) => r.status === 'assigned').length, late: rows.filter((r) => r.lvl === 2).length, rows, crews, rivers }
}

export interface Labels {
  title: string
  prepared: string
  open: string
  assigned: string
  late: string
  incidents: string
  place: string
  prio: string
  status: string
  team: string
  waited: string
  people: string
  needs: string
  crews: string
  seen: string
  never: string
  busy: string
  free: string
  rivers: string
  level: string
  mark: string
  rising: string
  sim: string
  none: string
  mins: string
  sign: string
  by: string
  to: string
  notes: string
  why: { unassigned: string; silent: string }
  need: Record<Need, string>
  vul: string
}

const el = (tag: string, cls = '', ...kids: (string | Node | null)[]): HTMLElement => {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  for (const k of kids) if (k !== null) e.append(k)
  return e
}
const table = (head: string[], rows: string[][]): HTMLElement => {
  const t = el('table', 'hvt')
  t.append(el('thead', '', el('tr', '', ...head.map((x) => el('th', '', x)))), el('tbody', '', ...rows.map((r) => el('tr', '', ...r.map((c) => el('td', '', c))))))
  return t
}

/** The sheet as DOM. Place names are citizen-derived text, so everything goes in through textContent. */
export function sheetEl(s: Sheet, L: Labels, who: string): HTMLElement {
  const when = new Date(s.at).toLocaleString()
  const inc = s.rows.length
    ? table(
        ['#', L.place, L.prio, L.status, L.waited, L.people, L.needs],
        s.rows.map((r, n) => [
          String(n + 1),
          r.place,
          String(r.score),
          r.status === 'assigned' ? `${L.assigned}: ${r.team || '—'}` : L.open,
          `${r.waited} ${L.mins}${r.lvl === 2 && r.why ? ' ⏰ ' + L.why[r.why] : ''}`,
          `${r.ppl || '—'}${r.vul ? ' ⚠ ' + L.vul : ''}`,
          r.needs.map((n) => L.need[n]).join(', ') || '—',
        ]),
      )
    : el('p', '', L.none)
  const crews = s.crews.length ? table([L.team, L.status, L.seen], s.crews.map((c) => [c.id, c.busy ? L.busy : L.free, c.seen === null ? L.never : `${c.seen} ${L.mins}`])) : el('p', '', L.none)
  const rivers = s.rivers.length
    ? table(
        [L.rivers, L.level, L.mark, L.rising],
        s.rivers.map((r) => [`${r.name} (${r.river})${r.sim ? ' · ' + L.sim : ''}`, r.lvl.toFixed(2), r.danger.toFixed(2), r.hrs !== null ? `${r.hrs} h` : '—']),
      )
    : el('p', '', L.none)
  return el(
    'div',
    'sheet',
    el('h2', '', L.title),
    el('p', 'hvm', `${L.prepared}: ${when}${who ? ' · ' + who : ''}`),
    el('p', 'hvc', `${L.open}: ${s.open} · ${L.assigned}: ${s.assigned} · ⏰ ${L.late}: ${s.late}`),
    el('h3', '', L.incidents),
    inc,
    el('h3', '', L.crews),
    crews,
    el('h3', '', L.rivers),
    rivers,
    el('h3', '', L.notes),
    el('div', 'hvn'),
    el('div', 'hvs', el('span', '', `${L.by}: ______________________`), el('span', '', `${L.to}: ______________________`), el('span', '', `${L.sign}: ____________`)),
  )
}
