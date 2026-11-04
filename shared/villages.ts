// Village-level lookup. The shipped index is empty: coordinates must come from a dataset you are
// licensed to use (for example an OpenStreetMap export), loaded with `npm run villages -- <file>`.
// Nothing here invents places. With an empty index the system falls back to district and town level.
import { hav } from './geo'

/** [name (latin, lowercase), name (devanagari), lat, lon, nearest known town] */
export type Vil = [string, string, number, number, string]
export interface VIdx {
  map: Map<string, Vil[]>
}

const STOP = new Set(['paani', 'pani', 'naav', 'nav', 'khana', 'log', 'ghar', 'gaon', 'gram', 'help', 'bahut', 'hai', 'hain', 'पानी', 'नाव', 'खाना', 'लोग', 'घर', 'गाँव', 'गांव', 'ग्राम', 'बहुत'])
const TOK = /[\p{L}\p{M}\p{N}]+/gu
// words that, next to a name, signal "this is a place": "Rampur me", "gaon Rampur", "रामपुर में"
const LOC = new Set(['me', 'mein', 'mai', 'ke', 'ka', 'ki', 'se', 'pe', 'par', 'paas', 'gaon', 'gram', 'village', 'vill', 'panchayat', 'में', 'मे', 'के', 'का', 'की', 'से', 'पर', 'पास', 'गाँव', 'गांव', 'ग्राम', 'पंचायत', 'गावँ'])

export function buildIndex(rows: Vil[]): VIdx {
  const map = new Map<string, Vil[]>()
  for (const r of rows) {
    for (const k of [r[0], r[1]]) {
      const key = k.trim().toLowerCase()
      if (key.length < 3 || STOP.has(key)) continue
      const a = map.get(key)
      if (a) a.push(r)
      else map.set(key, [r])
    }
  }
  return { map }
}

export interface Opt {
  near?: { lat: number; lon: number } | null // a pin or district centre: pick the closest same-named village
  dist?: string | null // a district/town named in the text
}

/**
 * Find the first village named in free text. A bare word is not enough (many village names are
 * ordinary words), so the name must be capitalised, or sit next to a locator word such as "me" or "gaon".
 * `amb` is true when several villages share the name and we had to guess.
 */
export function findVillage(text: string, idx: VIdx, o: Opt = {}): { v: Vil; amb: boolean } | null {
  if (!idx.map.size) return null
  const toks = [...text.matchAll(TOK)].map((m) => ({ raw: m[0], low: m[0].toLowerCase() }))
  for (let i = 0; i < toks.length; i++) {
    for (let n = Math.min(3, toks.length - i); n >= 1; n--) {
      const key = toks.slice(i, i + n).map((t) => t.low).join(' ')
      const hit = idx.map.get(key)
      if (!hit) continue
      const cap = /^[A-Z]/.test(toks[i].raw)
      const near = LOC.has(toks[i + n]?.low ?? '') || LOC.has(toks[i - 1]?.low ?? '')
      if (!cap && !near && !/[ऀ-ॿ]/.test(key)) continue // lowercase Latin word with no locator: skip
      if (/[ऀ-ॿ]/.test(key) && !near) continue // Devanagari word needs a locator too
      if (hit.length === 1) return { v: hit[0], amb: false }
      let best = hit[0]
      if (o.near) best = [...hit].sort((a, b) => hav(o.near!.lat, o.near!.lon, a[2], a[3]) - hav(o.near!.lat, o.near!.lon, b[2], b[3]))[0]
      else if (o.dist) best = hit.find((h) => h[4].toLowerCase() === o.dist!.toLowerCase()) ?? hit[0]
      return { v: best, amb: !o.near && !(o.dist && best[4].toLowerCase() === o.dist.toLowerCase()) }
    }
  }
  return null
}
