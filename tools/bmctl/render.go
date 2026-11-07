package main

import (
	"encoding/csv"
	"fmt"
	"io"
	"sort"
	"strings"
	"time"
	"unicode/utf8"
)

// ago prints an age like 7m, 3h, 2d.
func ago(ms int64, now time.Time) string {
	if ms <= 0 {
		return "-"
	}
	d := now.Sub(time.UnixMilli(ms))
	switch {
	case d < time.Minute:
		return "now"
	case d < time.Hour:
		return fmt.Sprintf("%dm", int(d.Minutes()))
	case d < 48*time.Hour:
		return fmt.Sprintf("%dh", int(d.Hours()))
	}
	return fmt.Sprintf("%dd", int(d.Hours()/24))
}

// pad pads by characters, not bytes, so Devanagari place names line up.
func pad(s string, n int) string {
	if k := utf8.RuneCountInString(s); k < n {
		return s + strings.Repeat(" ", n-k)
	}
	r := []rune(s)
	return string(r[:n])
}

// Queue prints the highest-priority incidents first.
func Queue(w io.Writer, incs []Inc, limit int, now time.Time) {
	sort.SliceStable(incs, func(a, b int) bool { return incs[a].Score > incs[b].Score })
	if limit > 0 && len(incs) > limit {
		incs = incs[:limit]
	}
	fmt.Fprintf(w, "%-5s %-18s %-4s %-6s %-9s %-16s %s\n", "SCORE", "PLACE", "REP", "PEOPLE", "WAITING", "STATUS", "NEEDS")
	for _, i := range incs {
		st := i.Status
		if i.Team != "" {
			st += ":" + i.Team
		}
		since := i.Opn
		if since == 0 {
			since = i.First
		}
		fmt.Fprintf(w, "%-5d %-18s %-4d %-6d %-9s %-16s %s\n", i.Score, pad(i.Place, 18), i.N, i.Ppl, ago(since, now), pad(st, 16), strings.Join(i.Needs, ","))
	}
	if len(incs) == 0 {
		fmt.Fprintln(w, "(no open incidents)")
	}
}

// Gauges prints levels against their danger marks. Simulated and stale readings are labelled, never hidden.
func Gauges(w io.Writer, gs []Gauge) {
	fmt.Fprintf(w, "%-22s %-8s %-8s %-8s %s\n", "STATION", "LEVEL", "DANGER", "MARGIN", "NOTE")
	for _, g := range gs {
		note := ""
		if g.Sim {
			note = "SIMULATED"
		}
		if g.Stale {
			note = strings.TrimSpace(note + " STALE")
		}
		fmt.Fprintf(w, "%-22s %-8.2f %-8.2f %-8.2f %s\n", pad(g.Name, 22), g.Lvl, g.Danger, g.Danger-g.Lvl, note)
	}
}

// iso formats a millisecond timestamp, or an empty cell when there is none.
func iso(ms int64) string {
	if ms <= 0 {
		return ""
	}
	return time.UnixMilli(ms).UTC().Format(time.RFC3339)
}

// safe stops a spreadsheet from running a place name as a formula (names come from citizen messages).
func safe(s string) string {
	if s != "" && strings.ContainsRune("=+-@\t\r", rune(s[0])) {
		return "'" + s
	}
	return s
}

// WriteCSV writes the incident list for a control room's own records. No reporter ids or message text.
func WriteCSV(w io.Writer, incs []Inc) error {
	cw := csv.NewWriter(w)
	_ = cw.Write([]string{"id", "place", "score", "status", "team", "reporters", "people", "severity", "vulnerable", "needs", "first_report", "opened", "assigned", "resolved", "closed_by"})
	for _, i := range incs {
		v := "no"
		if i.Vul {
			v = "yes"
		}
		_ = cw.Write([]string{safe(i.ID), safe(i.Place), fmt.Sprint(i.Score), i.Status, safe(i.Team), fmt.Sprint(i.N), fmt.Sprint(i.Ppl), fmt.Sprint(i.Sev), v, strings.Join(i.Needs, "|"), iso(i.First), iso(i.Opn), iso(i.Asg), iso(i.Res), i.By})
	}
	cw.Flush()
	return cw.Error()
}
