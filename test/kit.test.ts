import { describe, expect, it } from 'vitest'
import { adapt, authHeaders, normalize, parseMap } from '../backend/lib/feed'
import { agree, parseCsv, scoreOne, toLabs, wilson } from '../eval/score'
import { rulex } from '../shared/extract'

describe('independent accuracy kit', () => {
  it('parses quoted CSV with commas, quotes and newlines', () => {
    const r = parseCsv('id,t\n1,"a, ""b""\nc"\n2,plain\n')
    expect(r).toEqual([['id', 't'], ['1', 'a, "b"\nc'], ['2', 'plain']])
  })
  it('reads labels, mapping Hindi and Roman place names to the gazetteer', () => {
    const l = toLabs('id,t,place,depth,ppl,needs,vul,sev,labeler\n1,x,सुपौल,100,20,boat|food|junk,yes,4,A\n2,y,Smallvillage,,,,no,2,A\n3,z,,,,,no,1,A\n')
    expect(l[0]).toMatchObject({ place: 'Supaul', inGaz: true, depth: 100, ppl: 20, needs: ['boat', 'food'], vul: true, sev: 4 })
    expect(l[1]).toMatchObject({ place: 'Smallvillage', inGaz: false, depth: null })
    expect(l[2].place).toBeNull()
  })
  it('refuses a file with no severity or text column', () => {
    expect(() => toLabs('id,place\n1,x\n')).toThrow()
  })
  it('wilson interval widens with a small sample', () => {
    const [a, b] = wilson(9, 10)
    const [c, d] = wilson(900, 1000)
    expect(b - a).toBeGreaterThan(d - c)
    expect(a).toBeGreaterThan(0.5)
    expect(wilson(0, 0)).toEqual([0, 0])
  })
  it('scores a perfect prediction at 100% and counts unusable ones', () => {
    const labs = toLabs('id,t,place,depth,ppl,needs,vul,sev\n1,"सुपौल में पानी कमर तक है, 20 लोग फंसे हैं, नाव चाहिए",Supaul,100,20,boat,no,4\n')
    const g = rulex(labs[0].t)
    const r = scoreOne(labs, [{ ...g, place: 'Supaul', depth: 100, ppl: 20, needs: ['boat'], vul: false, sev: 4 }])
    expect(r.f.place).toEqual([1, 1])
    expect(r.needs.f1).toBeCloseTo(1)
    expect(scoreOne(labs, [null]).unusable).toBe(1)
  })
  it('measures agreement between two labelers', () => {
    const a = toLabs('id,t,place,depth,ppl,needs,vul,sev\n1,x,Patna,,,boat,no,3\n2,y,Gaya,,,,no,2\n')
    const b = toLabs('id,t,place,depth,ppl,needs,vul,sev\n1,x,Patna,,,boat,no,5\n2,y,Gaya,,,,no,2\n')
    const g = agree(a, b)
    expect(g.place).toEqual([2, 2])
    expect(g.sev1).toEqual([1, 2])
  })
})

describe('gauge feed adapter', () => {
  const map = { list: 'data.rows', id: 'code', lvl: 'lv.cm', ts: 'at', scale: 0.01, stations: { S1: { name: 'Test Ghat', river: 'Test', lat: 25.5, lon: 85.2, danger: 48 } } }
  it('reshapes a foreign feed, applies units and fills station details', () => {
    const rows = normalize(adapt({ data: { rows: [{ code: 'S1', lv: { cm: 4650 }, at: '2026-08-01T06:00:00Z' }] } }, map)).rows
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ id: 'S1', name: 'Test Ghat', lvl: 46.5, danger: 48, sim: false })
    expect(rows[0].ts).toBe(Date.parse('2026-08-01T06:00:00Z'))
  })
  it('never invents values: unknown station or missing level is dropped', () => {
    const r = normalize(adapt({ data: { rows: [{ code: 'NOPE', lv: { cm: 100 } }, { code: 'S1', lv: {} }] } }, map))
    expect(r.rows).toHaveLength(0)
    expect(r.dropped).toBe(2)
  })
  it('survives a feed with the wrong shape', () => {
    expect(adapt({ other: 1 }, map)).toEqual([])
    expect(adapt(null, map)).toEqual([])
  })
  it('parses the env map defensively', () => {
    expect(parseMap(undefined)).toBeNull()
    expect(parseMap('{bad')).toBeNull()
    expect(parseMap('{"id":"a"}')).toBeNull()
    expect(parseMap('{"id":"a","lvl":"b"}')).toMatchObject({ id: 'a' })
  })
})

describe('gauge feed credentials', () => {
  it('builds one header from the secret', () => {
    expect(authHeaders('{"header":"x-api-key","value":"abc"}')).toEqual({ 'x-api-key': 'abc' })
  })
  it('returns nothing for empty, malformed or unsafe secrets', () => {
    for (const bad of [undefined, '', '{', '{"header":"","value":""}', '{"header":"x-api-key"}', '{"header":"Host","value":"evil"}', '{"header":"bad header","value":"x"}', '{"header":"x-k","value":"a\\r\\nSet-Cookie: y"}']) expect(authHeaders(bad)).toEqual({})
  })
})
