import type { Inc, Need } from '../../shared/types'

/** A place on the map, opened in whatever maps app the phone has. */
export const mapLink = (lat: number, lon: number): string => `https://www.google.com/maps/search/?api=1&query=${lat.toFixed(5)},${lon.toFixed(5)}`

const NEED_EN: Record<Need, string> = { boat: 'boat', food: 'food', water: 'drinking water', medical: 'medical help', shelter: 'shelter' }
const NEED_HI: Record<Need, string> = { boat: 'नाव', food: 'खाना', water: 'पीने का पानी', medical: 'इलाज/दवा', shelter: 'आश्रय' }

/**
 * A short plain-text brief a dispatcher can paste into WhatsApp or SMS for a crew.
 * Only fields the system extracted and redacted go in: never the citizens' own message text, never a sender id.
 */
export function brief(i: Pick<Inc, 'id' | 'place' | 'lat' | 'lon' | 'score' | 'ppl' | 'vul' | 'needs' | 'n'>, lang: 'en' | 'hi'): string {
  const nd = (lang === 'hi' ? NEED_HI : NEED_EN)
  const needs = i.needs.map((n) => nd[n]).join(', ')
  const rows =
    lang === 'hi'
      ? [`बचाव: ${i.place} (प्राथमिकता ${i.score}/100)`, i.ppl ? `जोखिम में लोग: ${i.ppl}` : '', i.vul ? 'बच्चे/बुज़ुर्ग/बीमार हैं' : '', needs ? `ज़रूरत: ${needs}` : '', `${i.n} लोगों ने सूचना दी`, `जगह: ${mapLink(i.lat, i.lon)}`, `घटना: ${i.id}`]
      : [`Rescue: ${i.place} (priority ${i.score}/100)`, i.ppl ? `People at risk: ${i.ppl}` : '', i.vul ? 'Children / elderly / sick present' : '', needs ? `Needs: ${needs}` : '', `${i.n} independent report(s)`, `Location: ${mapLink(i.lat, i.lon)}`, `Incident: ${i.id}`]
  return rows.filter(Boolean).join('\n')
}

/** Opens WhatsApp with the text ready to send; the dispatcher chooses the person or group. */
export const waLink = (text: string): string => 'https://wa.me/?text=' + encodeURIComponent(text)
