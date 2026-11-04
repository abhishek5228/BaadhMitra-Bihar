import { ghash, gcent } from './geo'
import { nearest } from './gazetteer'
import { REVIEW_BELOW } from './extract'
import type { Inc, Rep } from './types'

const HR = 3600_000

/**
 * Priority score 0..100 for an incident.
 * Severity dominates; many independent reporters, many people at risk and vulnerable
 * people push it up; an incident that has gone quiet for a day decays a little so the
 * queue does not fill with stale items.
 */
export function score(i: Pick<Inc, 'sev' | 'n' | 'ppl' | 'vul' | 'needs' | 'last' | 'status'>, now = Date.now()): number {
  if (i.status === 'resolved') return 0
  let s = i.sev * 13 // up to 65
  s += Math.min(14, Math.log2(i.n + 1) * 5) // independent reporters
  s += Math.min(10, i.ppl / 4) // people at risk
  if (i.vul) s += 6
  if (i.needs.includes('medical')) s += 5
  const age = Math.max(0, now - i.last) / HR
  s *= 1 - Math.min(0.35, (age / 48) * 0.35)
  if (i.status === 'assigned') s *= 0.7 // help is on the way; keep visible but lower
  return Math.max(0, Math.min(100, Math.round(s)))
}

/**
 * Fold one extracted report into its incident (pure function, so it is unit-tested
 * and the same logic runs in the Lambda and in the browser demo).
 * `who` is the hashed sender id: the same person texting ten times counts once in `n`.
 */
export function merge(old: Inc | null, r: Rep, text: string, who: string, now = Date.now()): Inc {
  if (r.lat === null || r.lon === null) throw new Error('merge needs a located report')
  const id = ghash(r.lat, r.lon, 5)
  const c = gcent(id)
  const base: Inc =
    old ?? {
      id,
      place: r.place ?? nearest(r.lat, r.lon).p.en,
      lat: c.lat,
      lon: c.lon,
      n: 0,
      raw: 0,
      sev: 1,
      ppl: 0,
      vul: false,
      needs: [],
      conf: 0,
      review: false,
      first: now,
      last: now,
      status: 'open',
      score: 0,
      snips: [],
      who: [],
      ver: 0,
    }

  const fresh = !base.who.includes(who)
  const who2 = fresh ? [...base.who, who].slice(-200) : base.who
  const n = fresh ? base.n + 1 : base.n
  const raw = base.raw + 1
  const conf = Math.round(((base.conf * base.raw + r.conf) / raw) * 100) / 100
  const next: Inc = {
    ...base,
    n,
    raw,
    sev: Math.max(base.sev, r.sev),
    ppl: Math.max(base.ppl, r.ppl ?? 0),
    vul: base.vul || r.vul,
    needs: [...new Set([...base.needs, ...r.needs])],
    conf,
    // A cluster is "reviewed enough" once several independent people agree.
    review: n < 3 && (r.conf < REVIEW_BELOW || conf < REVIEW_BELOW),
    last: now,
    // A new report on a resolved incident re-opens it: the water came back.
    status: base.status === 'resolved' ? 'open' : base.status,
    snips: [...base.snips, { ts: now, t: text.slice(0, 240), conf: r.conf, src: r.src }].slice(-6),
    who: who2,
    ver: base.ver + 1,
  }
  next.score = score(next, now)
  return next
}
