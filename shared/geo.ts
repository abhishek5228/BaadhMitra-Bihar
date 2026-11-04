const B32 = '0123456789bcdefghjkmnpqrstuvwxyz'

/** Standard geohash encoder. precision 5 is a cell of about 4.9 km x 4.9 km. */
export function ghash(lat: number, lon: number, prec = 5): string {
  let la = [-90, 90]
  let lo = [-180, 180]
  let out = ''
  let bit = 0
  let idx = 0
  let even = true
  while (out.length < prec) {
    const rng = even ? lo : la
    const val = even ? lon : lat
    const mid = (rng[0] + rng[1]) / 2
    if (val >= mid) {
      idx = idx * 2 + 1
      rng[0] = mid
    } else {
      idx = idx * 2
      rng[1] = mid
    }
    even = !even
    if (++bit === 5) {
      out += B32[idx]
      bit = 0
      idx = 0
    }
  }
  return out
}

/** Centre of a geohash cell. */
export function gcent(h: string): { lat: number; lon: number } {
  let la = [-90, 90]
  let lo = [-180, 180]
  let even = true
  for (const c of h) {
    const v = B32.indexOf(c)
    for (let b = 4; b >= 0; b--) {
      const on = (v >> b) & 1
      const rng = even ? lo : la
      const mid = (rng[0] + rng[1]) / 2
      if (on) rng[0] = mid
      else rng[1] = mid
      even = !even
    }
  }
  return { lat: (la[0] + la[1]) / 2, lon: (lo[0] + lo[1]) / 2 }
}

/** Great-circle distance in km. */
export function hav(a: number, b: number, c: number, d: number): number {
  const r = Math.PI / 180
  const dl = (c - a) * r
  const dn = (d - b) * r
  const x = Math.sin(dl / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin(dn / 2) ** 2
  return 6371 * 2 * Math.asin(Math.sqrt(x))
}

/** Rough bounding box of Bihar; coordinates outside are rejected as bad input. */
export const BIHAR = { s: 24.2, n: 27.6, w: 83.2, e: 88.4 }

export function inBihar(lat: number, lon: number): boolean {
  return lat >= BIHAR.s && lat <= BIHAR.n && lon >= BIHAR.w && lon <= BIHAR.e
}
