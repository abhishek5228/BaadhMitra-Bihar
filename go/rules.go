// Package rules holds the overdue clock and time-to-danger rules, so a Go service can apply them
// to an exported incident list. Same rules as shared/sla.ts and shared/trend.ts.
package rules

import "math"

// Sla is how long an incident has waited and whether that is too long.
type Sla struct {
	Lvl  int    // 0 fine, 1 warning, 2 overdue
	Why  string // "unassigned", "silent" or ""
	Mins int64
}

func mins(ms int64) int64 {
	if ms <= 0 {
		return 0
	}
	return ms / 60000
}

// Check mirrors sla() in shared/sla.ts. Zero means "not set" for opn, asg and fts.
func Check(status string, score int, first, opn, asg, fts, last, now int64) Sla {
	pick := func(v ...int64) int64 {
		for _, x := range v {
			if x != 0 {
				return x
			}
		}
		return 0
	}
	switch status {
	case "open":
		m := mins(now - pick(opn, first))
		w, b := int64(30), int64(60)
		if score >= 75 {
			w, b = 15, 30
		}
		return Sla{level(m, w, b), "unassigned", m}
	case "assigned":
		m := mins(now - pick(fts, asg, last))
		return Sla{level(m, 60, 120), "silent", m}
	}
	return Sla{}
}

func level(m, warn, breach int64) int {
	if m >= breach {
		return 2
	}
	if m >= warn {
		return 1
	}
	return 0
}

// HoursToDanger is straight-line extrapolation of the current rise to the danger mark.
// ok is false when the river is not rising, is already above the mark, the reading is stale, or the answer is over 48 h out.
func HoursToDanger(lvl, danger, trend float64, stale bool) (h float64, ok bool) {
	if stale || !(trend >= 0.02) {
		return 0, false
	}
	gap := danger - lvl
	if gap <= 0 {
		return 0, false
	}
	h = gap / trend
	if h > 48 {
		return 0, false
	}
	return math.Floor(h*10+0.5) / 10, true
}
