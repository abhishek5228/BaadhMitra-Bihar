import type { Gauge } from './types'

/** Rises smaller than this (metres per hour) are noise from rounding, not a trend. */
export const MIN_RISE = 0.02
/** Do not promise a time further out than this: a straight line stops being honest. */
export const MAX_HOURS = 48

/**
 * Hours until a rising river reaches its danger mark, by straight-line extrapolation of the current rate.
 * Returns null when it is not rising, already above the mark, the reading cannot be trusted, or the answer is too far out.
 * This is arithmetic on one rate, not a forecast model: floods do not rise in straight lines.
 */
export function hoursToDanger(g: Pick<Gauge, 'lvl' | 'danger' | 'trend' | 'stale'>): number | null {
  if (g.stale || !(g.trend >= MIN_RISE)) return null
  const gap = g.danger - g.lvl
  if (gap <= 0) return null
  const h = gap / g.trend
  return h > MAX_HOURS ? null : Math.round(h * 10) / 10
}
