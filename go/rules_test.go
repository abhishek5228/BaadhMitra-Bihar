package rules

import (
	"bufio"
	"os"
	"strconv"
	"strings"
	"testing"
)

func opt(s string) int64 {
	if s == "-" {
		return 0
	}
	v, _ := strconv.ParseInt(s, 10, 64)
	return v
}

func TestVectors(t *testing.T) {
	f, err := os.Open("../conformance/vectors.tsv")
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 1<<20), 1<<20)
	n := 0
	for sc.Scan() {
		c := strings.Split(sc.Text(), "\t")
		switch c[0] {
		case "sla":
			score, _ := strconv.Atoi(c[2])
			got := Check(c[1], score, opt(c[3]), opt(c[4]), opt(c[5]), opt(c[6]), opt(c[7]), opt(c[8]))
			why := c[10]
			if why == "-" {
				why = ""
			}
			lvl, _ := strconv.Atoi(c[9])
			if got.Lvl != lvl || got.Why != why || got.Mins != opt(c[11]) {
				t.Errorf("sla %v: got %+v", c, got)
			}
			n++
		case "trend":
			l, _ := strconv.ParseFloat(c[1], 64)
			d, _ := strconv.ParseFloat(c[2], 64)
			tr, _ := strconv.ParseFloat(c[3], 64)
			h, ok := HoursToDanger(l, d, tr, c[4] == "1")
			if c[5] == "-" {
				if ok {
					t.Errorf("trend %v: got %v, want none", c, h)
				}
			} else if w, _ := strconv.ParseFloat(c[5], 64); !ok || h != w {
				t.Errorf("trend %v: got %v %v", c, h, ok)
			}
			n++
		}
	}
	if n < 900 {
		t.Fatalf("expected at least 900 vectors, saw %d", n)
	}
}
