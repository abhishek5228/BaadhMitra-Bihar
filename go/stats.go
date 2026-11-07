package rules

import (
	"math"
	"sort"
)

// Percentile is the nearest-rank percentile used for response times (q() in shared/sla.ts),
// rounded to one decimal. ok is false for an empty list.
func Percentile(a []float64, p float64) (v float64, ok bool) {
	if len(a) == 0 {
		return 0, false
	}
	s := append([]float64(nil), a...)
	sort.Float64s(s)
	i := int(math.Floor(p * float64(len(s))))
	if i > len(s)-1 {
		i = len(s) - 1
	}
	return math.Floor(s[i]*10+0.5) / 10, true
}
