// Official flood-forecast reference levels for Bihar river stations, as printed in Central Water Commission
// daily flood bulletins (https://cwc.gov.in, Central Flood Control Room). They are fixed marks, not readings.
// Warning, danger and highest-flood (HFL) levels are in metres above mean sea level.
// Positions are the nearest town centre, NOT the gauge site: replace them with the agency's coordinates.
export interface Ref {
  id: string
  name: string
  river: string
  dist: string
  warn: number
  danger: number
  hfl: number | null // null when not read from a bulletin
  lat: number
  lon: number
  src: string // bulletin the marks were read from
}

const B126 = 'CWC bulletin 126, 03/09/2024'
const B2021 = 'CWC bulletin 09/08/2021'

export const CWC_BIHAR: Ref[] = [
  { id: 'baltara', name: 'Baltara', river: 'Kosi', dist: 'Khagaria', warn: 32.85, danger: 33.85, hfl: 36.4, lat: 25.57, lon: 87.2, src: B126 },
  { id: 'benibad', name: 'Benibad', river: 'Bagmati', dist: 'Muzaffarpur', warn: 47.68, danger: 48.68, hfl: 50.01, lat: 26.12, lon: 85.39, src: B126 },
  { id: 'dumariaghat', name: 'Dumariaghat', river: 'Gandak', dist: 'Gopalganj', warn: 61.22, danger: 62.22, hfl: 64.36, lat: 26.47, lon: 84.44, src: B126 },
  { id: 'gandhighat', name: 'Gandhighat, Patna', river: 'Ganga', dist: 'Patna', warn: 47.6, danger: 48.6, hfl: 50.52, lat: 25.62, lon: 85.2, src: B126 },
  { id: 'hathidah', name: 'Hathidah', river: 'Ganga', dist: 'Patna', warn: 40.76, danger: 41.76, hfl: 43.52, lat: 25.4, lon: 85.99, src: B126 },
  { id: 'kahalgaon', name: 'Kahalgaon', river: 'Ganga', dist: 'Bhagalpur', warn: 30.09, danger: 31.09, hfl: 32.87, lat: 25.27, lon: 87.23, src: B126 },
  { id: 'khagaria', name: 'Khagaria', river: 'Burhi Gandak', dist: 'Khagaria', warn: 35.58, danger: 36.58, hfl: 39.22, lat: 25.51, lon: 86.47, src: B126 },
  { id: 'kursela', name: 'Kursela', river: 'Kosi', dist: 'Katihar', warn: 29.0, danger: 30.0, hfl: 32.1, lat: 25.48, lon: 87.27, src: B126 },
  { id: 'basua', name: 'Basua', river: 'Kosi', dist: 'Supaul', warn: 46.75, danger: 47.75, hfl: 49.24, lat: 26.28, lon: 86.78, src: B126 },
  { id: 'bhagalpur', name: 'Bhagalpur', river: 'Ganga', dist: 'Bhagalpur', warn: 32.68, danger: 33.68, hfl: 34.86, lat: 25.24, lon: 87.01, src: B126 },
  { id: 'darauli', name: 'Darauli', river: 'Ghagra', dist: 'Siwan', warn: 59.82, danger: 60.82, hfl: 61.82, lat: 26.22, lon: 84.36, src: B126 },
  { id: 'dheng', name: 'Dheng Bridge', river: 'Bagmati', dist: 'Sitamarhi', warn: 70.0, danger: 71.0, hfl: 73.0, lat: 26.59, lon: 85.48, src: B126 },
  { id: 'dighaghat', name: 'Dighaghat', river: 'Ganga', dist: 'Patna', warn: 49.45, danger: 50.45, hfl: 52.52, lat: 25.64, lon: 85.1, src: B126 },
  { id: 'gangpur', name: 'Gangpur Siswan', river: 'Ghagra', dist: 'Siwan', warn: 56.04, danger: 57.04, hfl: 58.26, lat: 26.22, lon: 84.36, src: B126 },
  { id: 'maner', name: 'Maner', river: 'Sone', dist: 'Patna', warn: 51.0, danger: 52.0, hfl: 53.79, lat: 25.65, lon: 84.87, src: B126 },
  { id: 'munger', name: 'Munger', river: 'Ganga', dist: 'Munger', warn: 38.33, danger: 39.33, hfl: 40.99, lat: 25.37, lon: 86.47, src: B126 },
  { id: 'runisaidpur', name: 'Runisaidpur', river: 'Bagmati', dist: 'Muzaffarpur', warn: 54.0, danger: 55.0, hfl: 58.15, lat: 26.12, lon: 85.39, src: B126 },
  { id: 'hajipur', name: 'Hajipur', river: 'Gandak', dist: 'Vaishali', warn: 49.32, danger: 50.32, hfl: null, lat: 25.69, lon: 85.22, src: B2021 },
]

/** The marks for one station; throws on an unknown id so a typo cannot silently fall back to a made-up number. */
export function ref(id: string): Ref {
  const r = CWC_BIHAR.find((x) => x.id === id)
  if (!r) throw new Error(`no CWC reference for ${id}`)
  return r
}

/** The `stations` table of a feed map (docs/feed-map.example.json). Keys are our ids: change them to the feed's own station codes. */
export function stationTable(): Record<string, { name: string; river: string; lat: number; lon: number; danger: number }> {
  const t: Record<string, { name: string; river: string; lat: number; lon: number; danger: number }> = {}
  for (const r of CWC_BIHAR) t[r.id] = { name: r.name, river: r.river, lat: r.lat, lon: r.lon, danger: r.danger }
  return t
}
