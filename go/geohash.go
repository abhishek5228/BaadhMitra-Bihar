package rules

import "strings"

const b32 = "0123456789bcdefghjkmnpqrstuvwxyz"

// Geohash encodes a position into a cell name; precision 5 is a cell of about 4.9 km. Same as ghash() in shared/geo.ts.
func Geohash(lat, lon float64, prec int) string {
	la := [2]float64{-90, 90}
	lo := [2]float64{-180, 180}
	var out strings.Builder
	bit, idx, even := 0, 0, true
	for out.Len() < prec {
		rng, val := &la, lat
		if even {
			rng, val = &lo, lon
		}
		mid := (rng[0] + rng[1]) / 2
		if val >= mid {
			idx = idx*2 + 1
			rng[0] = mid
		} else {
			idx *= 2
			rng[1] = mid
		}
		even = !even
		if bit++; bit == 5 {
			out.WriteByte(b32[idx])
			bit, idx = 0, 0
		}
	}
	return out.String()
}

// Centre returns the middle of a geohash cell.
func Centre(h string) (lat, lon float64) {
	la := [2]float64{-90, 90}
	lo := [2]float64{-180, 180}
	even := true
	for _, c := range h {
		v := strings.IndexRune(b32, c)
		for b := 4; b >= 0; b-- {
			rng := &la
			if even {
				rng = &lo
			}
			mid := (rng[0] + rng[1]) / 2
			if (v>>b)&1 == 1 {
				rng[0] = mid
			} else {
				rng[1] = mid
			}
			even = !even
		}
	}
	return (la[0] + la[1]) / 2, (lo[0] + lo[1]) / 2
}
