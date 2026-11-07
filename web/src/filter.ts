import type { Inc } from '../../shared/types'
import { sla } from '../../shared/sla'

export type Mode = 'all' | 'late' | 'free'

/** Lowercase and drop Latin accents so "Kursela" matches "kursela"; Devanagari passes through unchanged. */
const norm = (s: string): string => s.normalize('NFC').toLowerCase().trim()

/**
 * Narrow the rescue queue.
 *  all  = everything open
 *  late = overdue or past the warning mark
 *  free = nobody assigned yet
 * `q` matches the place name, any need, or the status. Order is never changed, the queue stays ranked.
 */
export function filt(incs: Inc[], q: string, mode: Mode, now: number): Inc[] {
  const t = norm(q)
  return incs.filter((i) => {
    if (mode === 'late' && sla(i, now).lvl === 0) return false
    if (mode === 'free' && i.status !== 'open') return false
    if (!t) return true
    return [i.place, i.status, ...(i.needs ?? [])].some((x) => norm(String(x)).includes(t))
  })
}
