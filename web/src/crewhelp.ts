import type { Inc } from '../../shared/types'

/** Jobs that appeared since the page last looked: the crew phone is often in a pocket, so these must announce themselves. */
export function newJobs(seen: ReadonlySet<string>, jobs: Inc[]): Inc[] {
  return jobs.filter((j) => !seen.has(j.id))
}

/** "just now", "12 min ago", "2 h ago" in the crew's language. */
export function since(ts: number, now: number, lang: 'hi' | 'en'): string {
  const m = Math.max(0, Math.floor((now - ts) / 60_000))
  if (m < 1) return lang === 'hi' ? 'अभी' : 'just now'
  if (m < 60) return lang === 'hi' ? `${m} मिनट पहले` : `${m} min ago`
  const h = Math.floor(m / 60)
  return lang === 'hi' ? `${h} घंटे पहले` : `${h} h ago`
}

/** Tab title that shows how many jobs the crew has. */
export const jobTitle = (n: number, base: string): string => (n > 0 ? `(${n}) ${base}` : base)
