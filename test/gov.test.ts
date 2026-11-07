import { describe, expect, it } from 'vitest'
import { createHmac } from 'node:crypto'
import { rulex } from '../shared/extract'
import { merge, score } from '../shared/score'
import { buildIndex, findVillage, type Vil } from '../shared/villages'
import { normalize, isStale, STALE_MS } from '../backend/lib/feed'
import { extOf, parseWa, sigok } from '../backend/lib/wa'

describe('dialect vocabulary (best effort, needs native-speaker review)', () => {
  it('reads Bhojpuri/Maithili distress words', () => {
    const r = rulex('मचान पर चढ़ल बानी, गरभवती मेहरारू बा, अन्न नइखे, पानी में डूबल घर')
    expect(r.needs).toContain('food')
    expect(r.vul).toBe(true)
  })
})

describe('dismissed incidents', () => {
  const rep = { place: 'Patna', lat: 25.6, lon: 85.1, depth: null, ppl: 4, needs: ['food'], vul: false, sev: 3, conf: 0.9, src: 'rule' } as const
  it('score is zero while dismissed', () => {
    const inc = merge(null, { ...rep, needs: ['food'] }, 'x', 'w1', 1000)
    expect(score({ ...inc, status: 'dismissed' }, 2000)).toBe(0)
  })
  it('a new independent reporter re-opens it', () => {
    const inc = { ...merge(null, { ...rep, needs: ['food'] }, 'x', 'w1', 1000), status: 'dismissed' as const }
    expect(merge(inc, { ...rep, needs: ['food'] }, 'y', 'w2', 2000).status).toBe('open')
  })
  it('the same reporter repeating does not', () => {
    const inc = { ...merge(null, { ...rep, needs: ['food'] }, 'x', 'w1', 1000), status: 'dismissed' as const }
    expect(merge(inc, { ...rep, needs: ['food'] }, 'y', 'w1', 2000).status).toBe('dismissed')
  })
})

describe('villages', () => {
  const idx = buildIndex([
    ['rampur', 'रामपुर', 25.9, 85.2, 'Hajipur'],
    ['rampur', 'रामपुर', 26.4, 84.8, 'Chhapra'],
    ['sundar', 'सुंदर', 25.1, 85.0, 'Patna'],
  ] as Vil[])
  it('empty index finds nothing', () => expect(findVillage('Rampur me paani', buildIndex([]))).toBeNull())
  it('needs a capital or locator, so ordinary words are skipped', () => {
    expect(findVillage('sundar din hai', idx)).toBeNull()
    expect(findVillage('Rampur me paani', idx)?.v[0]).toBe('rampur')
  })
  it('picks the closest namesake and flags a guess', () => {
    const hit = findVillage('Rampur me paani', idx, { near: { lat: 26.4, lon: 84.8 } })
    expect(hit?.v[4]).toBe('Chhapra')
    expect(hit?.amb).toBe(false)
    expect(findVillage('Rampur me paani', idx)?.amb).toBe(true)
  })
})

describe('gauge feed', () => {
  it('drops implausible readings', () => {
    const { rows, dropped } = normalize([
      { id: 'a', name: 'A', river: 'Ganga', lat: 25, lon: 85, lvl: 48.2, danger: 50.5, ts: '2026-08-01T00:00:00Z' },
      { id: 'b', lvl: 'x', danger: 50 },
      { id: 'c', lat: 25, lon: 85, lvl: 900, danger: 50 },
      null,
    ])
    expect(rows.length).toBe(1)
    expect(dropped).toBe(3)
  })
  it('drops a reading whose position is nowhere near the region', () => {
    const b = { id: 'a', lat: 25, lon: 85, lvl: 40, danger: 50 }
    expect(normalize([{ ...b, lat: 10 }]).dropped).toBe(1)
    expect(normalize([{ ...b, lat: 0, lon: 0 }]).dropped).toBe(1)
    expect(normalize([{ ...b, lat: 27.5, lon: 87.1 }]).rows).toHaveLength(1) // an upstream gauge across the border still counts
  })
  it('accepts seconds or ms timestamps and flags stale', () => {
    const now = Date.now()
    const a = normalize([{ id: 'a', lat: 25, lon: 85, lvl: 40, danger: 50, ts: Math.floor(now / 1000) }]).rows[0]
    expect(isStale(a.ts, now)).toBe(false)
    expect(isStale(now - STALE_MS - 1000, now)).toBe(true)
    expect(isStale(null, now)).toBe(false)
  })
})

describe('whatsapp webhook', () => {
  const raw = JSON.stringify({ entry: [{ changes: [{ value: { messages: [
    { id: 'w1', from: '919800000000', type: 'text', text: { body: 'paani aa gaya' } },
    { id: 'w2', from: '919800000000', type: 'location', location: { latitude: 25.6, longitude: 85.1 } },
    { id: 'w3', from: '919800000000', type: 'audio', audio: { id: 'm9', mime_type: 'audio/ogg; codecs=opus' } },
    { id: 'w4', from: '919800000000', type: 'image' },
  ] } }] }] })
  it('verifies signature and rejects wrong or missing', () => {
    const good = 'sha256=' + createHmac('sha256', 's3cret').update(raw).digest('hex')
    expect(sigok(raw, good, 's3cret')).toBe(true)
    expect(sigok(raw + ' ', good, 's3cret')).toBe(false)
    expect(sigok(raw, undefined, 's3cret')).toBe(false)
    expect(sigok(raw, good, '')).toBe(false)
    expect(sigok(raw, 'sha256=zz', 's3cret')).toBe(false)
  })
  it('flattens messages', () => {
    const m = parseWa(JSON.parse(raw))
    expect(m.map((x) => x.type)).toEqual(['text', 'location', 'audio', 'other'])
    expect(extOf(m[2].mime!)).toBe('ogg')
  })
  it('tolerates junk', () => expect(parseWa({ entry: 5 })).toEqual([]))
})

describe('citizen report page', async () => {
  // report.ts touches the DOM only inside main(); importing it for compose() is safe once document is stubbed.
  const store = new Map<string, string>()
  ;(globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) }
  const { compose } = await import('../web/src/compose')
  const q = await import('../web/src/queue')

  it('form fields become a sentence the extractor reads correctly', () => {
    const t = compose('सुपौल', '12', ['नाव चाहिए', 'पीने का पानी चाहिए'], 'बच्चे भी हैं')
    const r = rulex(t)
    expect(r.place).toBe('Supaul')
    expect(r.ppl).toBe(12)
    expect(r.needs).toEqual(expect.arrayContaining(['boat', 'water']))
    expect(r.vul).toBe(true)
  })

  it('keeps an unsent report and delivers it once the network is back', async () => {
    store.clear()
    q.add('सुपौल में पानी, नाव चाहिए', undefined, 1000)
    q.add('Kursela me paani', undefined, 2000)
    const offline = await q.flush(async () => {
      throw new Error('offline')
    })
    expect(offline).toEqual({ sent: 0, left: 2 })
    const got: string[] = []
    const online = await q.flush(async (i) => void got.push(i.text))
    expect(online).toEqual({ sent: 2, left: 0 })
    expect(got).toHaveLength(2)
  })
})

describe('overdue clock and response metrics', async () => {
  const { sla, metrics } = await import('../shared/sla')
  const min = 60_000
  const base = { status: 'open', score: 80, first: 0, last: 0 } as any
  it('urgent incidents get half the time before they are overdue', () => {
    expect(sla(base, 10 * min).lvl).toBe(0)
    expect(sla(base, 16 * min).lvl).toBe(1)
    expect(sla(base, 31 * min).lvl).toBe(2)
    expect(sla({ ...base, score: 40 }, 31 * min).lvl).toBe(1)
    expect(sla({ ...base, score: 40 }, 61 * min).lvl).toBe(2)
  })
  it('an assigned incident goes overdue when the team is silent, and a field update resets it', () => {
    const a = { ...base, status: 'assigned', asg: 0 }
    expect(sla(a, 59 * min).lvl).toBe(0)
    expect(sla(a, 121 * min)).toMatchObject({ lvl: 2, why: 'silent' })
    expect(sla({ ...a, fts: 100 * min }, 121 * min).lvl).toBe(0)
  })
  it('resolved or dismissed incidents are never overdue', () => {
    expect(sla({ ...base, status: 'resolved' }, 9999 * min).lvl).toBe(0)
  })
  it('metrics use only recorded times and the latest verdict per incident', () => {
    const inc = (id: string, asg: number, res?: number, by?: string) => ({ ...base, id, status: res ? 'resolved' : 'assigned', asg: asg * min, res: res ? res * min : undefined, by })
    const fb = (inc: string, ts: number, ok: boolean, wrong: string[] = []) => ({ id: inc + ts, ts, actor: 'a', inc, ok, wrong, place: '', ppl: 0, needs: [], sev: 1, texts: [] })
    const m = metrics([inc('a', 10, 70, 'team'), inc('b', 30, 90, 'control'), inc('c', 50)] as any, [fb('a', 1, false, ['place']), fb('a', 2, true), fb('b', 1, false, ['people'])] as any, 200 * min)
    expect(m.toAssign).toMatchObject({ n: 3, p50: 30 })
    expect(m.toResolve).toMatchObject({ n: 2, p50: 60 })
    expect(m).toMatchObject({ teamClosed: 1, controlClosed: 1, resolved: 2, assigned: 1 })
    expect(m.fb).toMatchObject({ n: 2, ok: 1, rate: 0.5, wrong: { people: 1, place: 0 } }) // a's corrected verdict replaced the first
    expect(metrics([], [], 0).fb.rate).toBeNull()
  })
})
