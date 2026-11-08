import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { merge, score } from '../shared/score'
import { gcent, ghash, hav } from '../shared/geo'
import { redact } from '../shared/redact'
import { NEEDS, type Need, type Rep } from '../shared/types'

// Property tests: instead of hand-picked examples, thousands of generated inputs must keep the
// invariants the dispatcher relies on.

const NOW = 1_800_000_000_000
const need = fc.constantFrom<Need>(...NEEDS)
const rep = fc.record({
  place: fc.constant(null),
  lat: fc.double({ min: 25.0, max: 25.0003, noNaN: true }), // all inside one geohash5 cell
  lon: fc.double({ min: 86.0, max: 86.0003, noNaN: true }),
  depth: fc.constant(null),
  ppl: fc.option(fc.integer({ min: 0, max: 500 }), { nil: null }),
  needs: fc.uniqueArray(need),
  vul: fc.boolean(),
  sev: fc.constantFrom(1, 2, 3, 4, 5),
  conf: fc.double({ min: 0, max: 1, noNaN: true }),
  src: fc.constantFrom('llm', 'rule'),
}) as fc.Arbitrary<Rep>
const step = fc.record({ r: rep, who: fc.constantFrom('a', 'b', 'c', 'd', 'e'), dt: fc.integer({ min: 0, max: 7_200_000 }) })

const fold = (steps: { r: Rep; who: string; dt: number }[]) => {
  let inc = null as ReturnType<typeof merge> | null
  let t = NOW
  for (const s of steps) {
    t += s.dt
    inc = merge(inc, s.r, 'text', s.who, t)
  }
  return inc!
}

describe('merge / score invariants', () => {
  it('score is always an integer in 0..100', () => {
    fc.assert(
      fc.property(fc.array(step, { minLength: 1, maxLength: 25 }), (steps) => {
        const i = fold(steps)
        expect(Number.isInteger(i.score)).toBe(true)
        expect(i.score).toBeGreaterThanOrEqual(0)
        expect(i.score).toBeLessThanOrEqual(100)
      }),
    )
  })

  it('each report is counted once, unique reporters never exceed reports, version rises by one', () => {
    fc.assert(
      fc.property(fc.array(step, { minLength: 1, maxLength: 25 }), (steps) => {
        const i = fold(steps)
        expect(i.raw).toBe(steps.length)
        expect(i.ver).toBe(steps.length)
        expect(i.n).toBe(new Set(steps.map((s) => s.who)).size)
        expect(i.n).toBeLessThanOrEqual(i.raw)
      }),
    )
  })

  it('severity, people at risk, needs and vulnerability only ever grow', () => {
    fc.assert(
      fc.property(fc.array(step, { minLength: 2, maxLength: 20 }), (steps) => {
        const prev = fold(steps.slice(0, -1))
        const next = fold(steps)
        expect(next.sev).toBeGreaterThanOrEqual(prev.sev)
        expect(next.ppl).toBeGreaterThanOrEqual(prev.ppl)
        expect(prev.needs.every((n) => next.needs.includes(n))).toBe(true)
        expect(next.vul || !prev.vul).toBe(true)
      }),
    )
  })

  it('what the queue shows does not depend on the order reports arrived in', () => {
    fc.assert(
      fc.property(fc.array(step, { minLength: 1, maxLength: 15 }), fc.integer(), (steps, seed) => {
        const same = steps.map((s) => ({ ...s, dt: 0 })) // identical timestamps, so only order differs
        const shuffled = [...same].sort((a, b) => ((a.who.charCodeAt(0) * seed) % 7) - ((b.who.charCodeAt(0) * seed) % 7))
        const a = fold(same)
        const b = fold(shuffled)
        expect({ n: a.n, raw: a.raw, sev: a.sev, ppl: a.ppl, vul: a.vul, needs: [...a.needs].sort() }).toEqual({ n: b.n, raw: b.raw, sev: b.sev, ppl: b.ppl, vul: b.vul, needs: [...b.needs].sort() })
      }),
    )
  })

  it('more severe is never ranked lower, all else equal', () => {
    const base = { n: 2, ppl: 5, vul: false, needs: [] as Need[], last: NOW, status: 'open' as const }
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 4 }), fc.integer({ min: 1, max: 40 }), fc.integer({ min: 0, max: 200 }), (sev, n, ppl) => {
        expect(score({ ...base, sev, n, ppl }, NOW)).toBeLessThanOrEqual(score({ ...base, sev: sev + 1, n, ppl }, NOW))
      }),
    )
  })

  it('more reporters or more people at risk never lowers the score', () => {
    const base = { sev: 3 as const, vul: false, needs: [] as Need[], last: NOW, status: 'open' as const }
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 60 }), fc.integer({ min: 0, max: 300 }), fc.integer({ min: 0, max: 50 }), fc.integer({ min: 0, max: 50 }), (n, ppl, dn, dp) => {
        expect(score({ ...base, n, ppl }, NOW)).toBeLessThanOrEqual(score({ ...base, n: n + dn, ppl: ppl + dp }, NOW))
      }),
    )
  })

  it('closed incidents score zero and a resolved one re-opens on a new report', () => {
    fc.assert(
      fc.property(rep, fc.constantFrom('resolved', 'dismissed' as const), (r, status) => {
        const open = merge(null, r, 't', 'a', NOW)
        const closed = { ...open, status, score: 0 }
        expect(score(closed, NOW)).toBe(0)
        const again = merge(closed, r, 't', 'zz-new', NOW + 1)
        expect(again.status).toBe('open')
        expect(again.score).toBeGreaterThan(0)
      }),
    )
  })
})

describe('geo and redaction invariants', () => {
  const lat = fc.double({ min: 24.2, max: 27.6, noNaN: true })
  const lon = fc.double({ min: 83.2, max: 88.4, noNaN: true })

  it('a cell centre hashes back to the same cell and lies within ~4 km of the point', () => {
    fc.assert(
      fc.property(lat, lon, (la, lo) => {
        const h = ghash(la, lo, 5)
        const c = gcent(h)
        expect(ghash(c.lat, c.lon, 5)).toBe(h)
        expect(hav(la, lo, c.lat, c.lon)).toBeLessThan(4)
      }),
    )
  })

  it('distance is symmetric, non-negative and zero to itself', () => {
    fc.assert(
      fc.property(lat, lon, lat, lon, (a, b, c, d) => {
        expect(hav(a, b, c, d)).toBeCloseTo(hav(c, d, a, b), 9)
        expect(hav(a, b, c, d)).toBeGreaterThanOrEqual(0)
        expect(hav(a, b, a, b)).toBe(0)
      }),
    )
  })

  it('redact is idempotent and never leaves an Indian mobile number or email behind', () => {
    const mobile = fc.tuple(fc.constantFrom('6', '7', '8', '9'), fc.stringMatching(/^[0-9]{9}$/)).map(([a, b]) => a + b)
    fc.assert(
      fc.property(fc.string({ maxLength: 40 }), mobile, fc.string({ maxLength: 20 }), (pre, num, post) => {
        const out = redact(`${pre} call ${num} ${post} x@mail.com`)
        expect(out).not.toContain(num)
        expect(out).not.toContain('x@mail.com')
        expect(redact(out)).toBe(out)
      }),
    )
  })
})
