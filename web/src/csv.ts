import type { Inc } from '../../shared/types'
import { sla } from '../../shared/sla'

/**
 * One CSV cell. Quotes when needed, and neutralises spreadsheet formulas: place names come from
 * citizen messages, and Excel runs a cell that starts with = + - @ as a formula.
 */
export function cell(v: unknown): string {
  let s = v === null || v === undefined ? '' : String(v)
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
}

const iso = (t?: number): string => (t ? new Date(t).toISOString() : '')

export const COLS = ['id', 'place', 'score', 'status', 'team', 'reporters', 'people', 'severity', 'vulnerable', 'needs', 'first_report', 'opened', 'assigned', 'resolved', 'closed_by', 'overdue']

/** Incident list as CSV for a control room's own records. No reporter ids or message text are included. */
export function toCsv(incs: Inc[], now: number): string {
  const rows = incs.map((i) => {
    const s = sla(i, now)
    return [i.id, i.place, i.score, i.status, i.team ?? '', i.n, i.ppl, i.sev, i.vul ? 'yes' : 'no', i.needs.join('|'), iso(i.first), iso(i.opn), iso(i.asg), iso(i.res), i.by ?? '', s.lvl === 2 ? 'overdue' : s.lvl === 1 ? 'warning' : ''].map(cell).join(',')
  })
  return '﻿' + [COLS.join(','), ...rows].join('\r\n') + '\r\n'
}
