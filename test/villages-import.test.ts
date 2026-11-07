import { describe, expect, it } from 'vitest'
import { build, fromCsv, fromOverpass } from '../scripts/vlib'
import { buildIndex, findVillage } from '../shared/villages'

// Invented sample in the shape of an Overpass export. Coordinates are near Supaul but the villages are made up.
const OVP = JSON.stringify({
  elements: [
    { type: 'node', lat: 26.12, lon: 86.6, tags: { name: 'Rampur Test', 'name:hi': 'रामपुर टेस्ट' } },
    { type: 'way', center: { lat: 26.2, lon: 86.7 }, tags: { name: 'लालपुर' } },
    { type: 'node', lat: 26.12, lon: 86.6, tags: { name: 'Rampur Test', 'name:hi': 'रामपुर टेस्ट' } }, // duplicate
    { type: 'node', lat: 28.6, lon: 77.2, tags: { name: 'Delhi Village' } }, // outside Bihar
    { type: 'node', lat: 26.0, lon: 86.5, tags: {} }, // no name
    { type: 'node', tags: { name: 'No Position' } },
  ],
})

describe('village importer', () => {
  it('reads nodes and the centre of ways, skipping unnamed or unplaced elements', () => {
    const r = fromOverpass(OVP)
    expect(r.map((x) => x.name || x.hi)).toEqual(['Rampur Test', 'लालपुर', 'Rampur Test', 'Delhi Village'])
  })
  it('keeps only Bihar villages, removes duplicates, and links each to a nearby town', () => {
    const v = build(fromOverpass(OVP))
    expect(v).toHaveLength(2)
    expect(v[0][0]).toBe('rampur test')
    expect(typeof v[0][4]).toBe('string')
  })
  it('reads a CSV with quoted commas and any column order', () => {
    const r = fromCsv('lat,lon,name,hi\n26.1,86.6,"Rampur, Test",रामपुर\n,,skip,\n')
    expect(r).toEqual([{ name: 'Rampur, Test', hi: 'रामपुर', lat: 26.1, lon: 86.6 }])
    expect(() => fromCsv('name,hi\nx,y\n')).toThrow()
  })
  it('imported villages are found in a message', () => {
    const idx = buildIndex(build(fromOverpass(OVP)))
    expect(findVillage('लालपुर में पानी भर गया', idx)?.v[0]).toBe('')
  })
})
