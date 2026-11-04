// Pure helper, kept apart from report.ts so tests can import it without starting the page.
/** Build the sentence the backend reads from the form fields, in the Hindi the extractor knows best. */
export function compose(place: string, ppl: string, needs: string[], free: string): string {
  const parts: string[] = []
  const pl = place.trim()
  const n = Number(ppl)
  if (pl) parts.push(`${pl} में पानी भर गया है`)
  if (Number.isFinite(n) && n > 0) parts.push(`${Math.floor(n)} लोग फंसे हैं`)
  parts.push(...needs)
  if (free.trim()) parts.push(free.trim())
  return parts.join(', ')
}

