// A small offline gazetteer of Bihar district HQs and well-known flood-prone towns.
// Coordinates are approximate (town centres). It lets us place a report on the map
// with no network call, which matters when connectivity is failing during a flood.
// Production upgrade path: Amazon Location Service place index for village-level lookup.
import { hav } from './geo'

export interface Place {
  en: string
  hi: string[] // Devanagari spellings and common variants
  alt?: string[] // romanised variants used in Hinglish
  amb?: boolean // Latin spelling is also a common Hindi word (gaya = went, barh = flood); match only when capitalised
  lat: number
  lon: number
}

export const PLACES: Place[] = [
  { en: 'Patna', hi: ['पटना'], lat: 25.61, lon: 85.14 },
  { en: 'Gaya', hi: ['गया'], amb: true, lat: 24.8, lon: 85.0 },
  { en: 'Muzaffarpur', hi: ['मुजफ्फरपुर', 'मुज़फ़्फ़रपुर'], alt: ['muzzafarpur', 'muzaffarpur'], lat: 26.12, lon: 85.39 },
  { en: 'Darbhanga', hi: ['दरभंगा'], lat: 26.16, lon: 85.9 },
  { en: 'Saharsa', hi: ['सहरसा'], lat: 25.88, lon: 86.6 },
  { en: 'Supaul', hi: ['सुपौल'], lat: 26.12, lon: 86.6 },
  { en: 'Madhepura', hi: ['मधेपुरा'], lat: 25.92, lon: 86.79 },
  { en: 'Araria', hi: ['अररिया'], lat: 26.15, lon: 87.47 },
  { en: 'Purnia', hi: ['पूर्णिया', 'पूर्णिया'], alt: ['purnea'], lat: 25.78, lon: 87.47 },
  { en: 'Katihar', hi: ['कटिहार'], lat: 25.54, lon: 87.57 },
  { en: 'Bhagalpur', hi: ['भागलपुर'], lat: 25.24, lon: 87.01 },
  { en: 'Khagaria', hi: ['खगड़िया', 'खगरिया'], lat: 25.5, lon: 86.47 },
  { en: 'Begusarai', hi: ['बेगूसराय'], lat: 25.42, lon: 86.13 },
  { en: 'Samastipur', hi: ['समस्तीपुर'], lat: 25.86, lon: 85.78 },
  { en: 'Sitamarhi', hi: ['सीतामढ़ी', 'सीतामढी'], lat: 26.59, lon: 85.49 },
  { en: 'Motihari', hi: ['मोतिहारी'], lat: 26.65, lon: 84.92 },
  { en: 'Gopalganj', hi: ['गोपालगंज'], lat: 26.47, lon: 84.44 },
  { en: 'Chapra', hi: ['छपरा', 'सारण'], alt: ['saran'], lat: 25.78, lon: 84.75 },
  { en: 'Siwan', hi: ['सिवान'], lat: 26.22, lon: 84.36 },
  { en: 'Buxar', hi: ['बक्सर'], lat: 25.56, lon: 83.98 },
  { en: 'Ara', hi: ['आरा', 'भोजपुर'], alt: ['arrah', 'bhojpur'], amb: true, lat: 25.56, lon: 84.67 },
  { en: 'Hajipur', hi: ['हाजीपुर', 'वैशाली'], alt: ['vaishali'], lat: 25.69, lon: 85.21 },
  { en: 'Munger', hi: ['मुंगेर', 'मुगेर'], alt: ['monghyr'], lat: 25.38, lon: 86.47 },
  { en: 'Kishanganj', hi: ['किशनगंज'], lat: 26.1, lon: 87.95 },
  { en: 'Madhubani', hi: ['मधुबनी'], lat: 26.35, lon: 86.07 },
  { en: 'Sheohar', hi: ['शिवहर', 'शेओहर'], lat: 26.52, lon: 85.3 },
  { en: 'Bettiah', hi: ['बेतिया', 'पश्चिम चंपारण'], lat: 26.8, lon: 84.5 },
  { en: 'Biharsharif', hi: ['बिहारशरीफ', 'नालंदा'], alt: ['nalanda'], lat: 25.2, lon: 85.52 },
  { en: 'Jamui', hi: ['जमुई'], lat: 24.92, lon: 86.22 },
  { en: 'Banka', hi: ['बांका', 'बाँका'], lat: 24.89, lon: 86.92 },
  { en: 'Lakhisarai', hi: ['लखीसराय'], lat: 25.17, lon: 86.1 },
  { en: 'Sasaram', hi: ['सासाराम', 'रोहतास'], alt: ['rohtas'], lat: 24.95, lon: 84.03 },
  // Kosi / Ganga / Gandak belt towns that show up often in flood reports
  { en: 'Kursela', hi: ['कुरसेला'], lat: 25.48, lon: 87.27 },
  { en: 'Birpur', hi: ['बीरपुर'], lat: 26.5, lon: 86.95 },
  { en: 'Nirmali', hi: ['निर्मली'], lat: 26.31, lon: 86.58 },
  { en: 'Murliganj', hi: ['मुरलीगंज'], lat: 25.9, lon: 86.98 },
  { en: 'Naugachia', hi: ['नौगछिया'], lat: 25.4, lon: 87.1 },
  { en: 'Barh', hi: [], alt: [], amb: true, lat: 25.48, lon: 85.71 },
  { en: 'Mokama', hi: ['मोकामा'], lat: 25.4, lon: 85.92 },
  { en: 'Manihari', hi: ['मनिहारी'], lat: 25.35, lon: 87.62 },
]

const DEV = '०१२३४५६७८९'
/** Convert Devanagari digits to ASCII so number parsing works for both scripts. */
export function ascii(s: string): string {
  return s.replace(/[०-९]/g, (c) => String(DEV.indexOf(c)))
}

function esc(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const IDX = PLACES.map((p) => {
  const names = [p.en, ...(p.alt ?? [])].map((s) => s.toLowerCase())
  return { p, names, hi: p.hi }
})

/** Find the first known place mentioned in free text (English, Hinglish or Hindi). */
export function locate(text: string): Place | null {
  const low = text.toLowerCase()
  let best: { p: Place; at: number } | null = null
  const take = (p: Place, at: number) => {
    if (!best || at < best.at) best = { p, at }
  }
  for (const e of IDX) {
    for (const nm of e.names) {
      if (e.p.amb) {
        // "paani aa gaya" must not become Gaya, and "barh" (flood) must not become Barh:
        // for these names, require the capitalised spelling in the original text.
        const cap = nm.charAt(0).toUpperCase() + nm.slice(1)
        const m = new RegExp(`(^|[^A-Za-z])${esc(cap)}([^A-Za-z]|$)`).exec(text)
        if (m) take(e.p, m.index)
        continue
      }
      // Word boundaries for Latin names so a short name never matches inside another word.
      const m = new RegExp(`(^|[^a-z])${esc(nm)}([^a-z]|$)`).exec(low)
      if (m) take(e.p, m.index)
    }
    for (const h of e.hi) {
      const at = low.indexOf(h)
      if (at >= 0) take(e.p, at)
    }
  }
  return best ? (best as { p: Place; at: number }).p : null
}

/** Nearest known place to a coordinate, with the distance in km. */
export function nearest(lat: number, lon: number): { p: Place; km: number } {
  let top = PLACES[0]
  let dist = Infinity
  for (const p of PLACES) {
    const d = hav(lat, lon, p.lat, p.lon)
    if (d < dist) {
      dist = d
      top = p
    }
  }
  return { p: top, km: dist }
}
