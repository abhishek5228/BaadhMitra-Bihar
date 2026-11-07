import type { Fb, Inc, Metrics, Pct, Wrong } from './types'
import { WRONGS } from './types'

// Overdue thresholds in minutes: [warn, breach]. Urgent incidents (score >= 75) get half the time.
// These are starting values to agree with the control room, not official standards.
const UNASSIGNED: Record<'hi' | 'lo', [number, number]> = { hi: [15, 30], lo: [30, 60] }
const SILENT: [number, number] = [60, 120] // assigned but no word from the team

export interface Sla {
  lvl: 0 | 1 | 2 // 0 fine, 1 warning, 2 overdue
  why: 'unassigned' | 'silent' | null
  mins: number // minutes spent in the current wait
}

const min = (ms: number) => Math.max(0, Math.floor(ms / 60000))

/** How long has this incident been waiting, and is that too long? Pure, so the page and the Lambda agree. */
export function sla(i: Pick<Inc, 'status' | 'score' | 'first' | 'opn' | 'asg' | 'fts' | 'last'>, now: number): Sla {
  if (i.status === 'open') {
    const m = min(now - (i.opn ?? i.first))
    const [w, b] = UNASSIGNED[i.score >= 75 ? 'hi' : 'lo']
    return { lvl: m >= b ? 2 : m >= w ? 1 : 0, why: 'unassigned', mins: m }
  }
  if (i.status === 'assigned') {
    const m = min(now - (i.fts ?? i.asg ?? i.last))
    return { lvl: m >= SILENT[1] ? 2 : m >= SILENT[0] ? 1 : 0, why: 'silent', mins: m }
  }
  return { lvl: 0, why: null, mins: 0 }
}

export const q = (a: number[], p: number): number | null => {
  if (!a.length) return null
  const s = [...a].sort((x, y) => x - y)
  return Math.round(s[Math.min(s.length - 1, Math.floor(p * s.length))] * 10) / 10
}
const pct = (a: number[]): Pct => ({ n: a.length, p50: q(a, 0.5), p90: q(a, 0.9) })

/** Response-time and feedback numbers, computed only from what the system itself recorded. */
export function metrics(incs: Inc[], fbs: Fb[], now: number): Metrics {
  const toA: number[] = []
  const toR: number[] = []
  let overdue = 0
  for (const i of incs) {
    if (i.asg) toA.push((i.asg - (i.opn ?? i.first)) / 60000)
    if (i.res && i.asg) toR.push((i.res - i.asg) / 60000)
    if (sla(i, now).lvl === 2) overdue++
  }
  // latest verdict per incident, so a corrected click replaces the earlier one
  const last = new Map<string, Fb>()
  for (const f of [...fbs].sort((a, b) => a.ts - b.ts)) last.set(f.inc, f)
  const wrong = Object.fromEntries(WRONGS.map((w) => [w, 0])) as Record<Wrong, number>
  let ok = 0
  for (const f of last.values()) {
    if (f.ok) ok++
    else for (const w of f.wrong) wrong[w]++
  }
  const n = last.size
  const c = (s: Inc['status']) => incs.filter((i) => i.status === s).length
  return {
    incidents: incs.length,
    open: c('open'),
    assigned: c('assigned'),
    resolved: c('resolved'),
    dismissed: c('dismissed'),
    overdue,
    toAssign: pct(toA),
    toResolve: pct(toR),
    teamClosed: incs.filter((i) => i.status === 'resolved' && i.by === 'team').length,
    controlClosed: incs.filter((i) => i.status === 'resolved' && i.by === 'control').length,
    fb: { n, ok, rate: n ? Math.round((ok / n) * 100) / 100 : null, wrong },
  }
}
