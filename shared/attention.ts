import { sla } from './sla'
import { hoursToDanger } from './trend'
import { FRESH_MS } from './suggest'
import type { Gauge, Inc, Team } from './types'

export type Kind = 'unassigned' | 'silent' | 'soon' | 'nocrew' | 'rising' | 'unplaced' | 'review' | 'stale'

export interface Issue {
  kind: Kind
  lvl: 1 | 2 // 1 look at it, 2 act now
  n: number // how many things are affected
  ref?: string // incident to open when clicked
  hrs?: number // for rising rivers: the soonest estimate
}

/** A river rising towards its danger mark within this many hours is worth a dispatcher's attention now. */
export const RISING_WITHIN = 6

const ORDER: Kind[] = ['unassigned', 'silent', 'nocrew', 'rising', 'soon', 'unplaced', 'review', 'stale']

/**
 * What needs a human right now. Pure and cheap, so the dashboard recomputes it on every refresh.
 * It only points at problems the data already shows; it fixes nothing by itself and invents nothing.
 */
export function attention(x: { incs: Inc[]; gauges: Gauge[]; teams: Team[] | null; unplaced: number; now: number }): Issue[] {
  const out: Issue[] = []
  const live = x.incs.filter((i) => i.status === 'open' || i.status === 'assigned')
  const rows = live.map((i) => ({ i, s: sla(i, x.now) }))

  const worst = (a: typeof rows): string | undefined => [...a].sort((p, q) => q.i.score - p.i.score || q.s.mins - p.s.mins)[0]?.i.id
  const un = rows.filter((r) => r.s.lvl === 2 && r.s.why === 'unassigned')
  if (un.length) out.push({ kind: 'unassigned', lvl: 2, n: un.length, ref: worst(un) })
  const si = rows.filter((r) => r.s.lvl === 2 && r.s.why === 'silent')
  if (si.length) out.push({ kind: 'silent', lvl: 2, n: si.length, ref: worst(si) })
  const so = rows.filter((r) => r.s.lvl === 1)
  if (so.length) out.push({ kind: 'soon', lvl: 1, n: so.length, ref: worst(so) })

  // open incidents and nobody who has shared a recent position: dispatch would be blind
  // teams === null means the crew list could not be loaded: unknown is not the same as nobody, so say nothing
  const fresh = (x.teams ?? []).filter((t) => t.ts && x.now - t.ts <= FRESH_MS).length
  const open = rows.filter((r) => r.i.status === 'open')
  if (x.teams && open.length && !fresh) out.push({ kind: 'nocrew', lvl: 2, n: open.length, ref: worst(open) })

  const hrs = x.gauges.map((g) => hoursToDanger(g)).filter((h): h is number => h !== null && h <= RISING_WITHIN)
  if (hrs.length) out.push({ kind: 'rising', lvl: Math.min(...hrs) <= 2 ? 2 : 1, n: hrs.length, hrs: Math.min(...hrs) })

  if (x.unplaced > 0) out.push({ kind: 'unplaced', lvl: 1, n: x.unplaced })
  const rv = live.filter((i) => i.review)
  if (rv.length) out.push({ kind: 'review', lvl: 1, n: rv.length, ref: [...rv].sort((a, b) => b.score - a.score)[0].id })
  const sg = x.gauges.filter((g) => g.stale).length
  if (sg) out.push({ kind: 'stale', lvl: 1, n: sg })

  return out.sort((a, b) => b.lvl - a.lvl || ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind))
}
