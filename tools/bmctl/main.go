// bmctl: a terminal client for BaadhMitra. One static binary for a control room PC with a poor connection
// or no browser. Read-only: it shows the queue and river gauges and exports the incident list.
//
//	BM_API=https://xxxx.execute-api.ap-southeast-2.amazonaws.com/prod BM_CLIENT=<client id> BM_USER=<email> BM_PASS=<password> bmctl queue
//
// Commands: queue [-n 15], gauges, export -o incidents.csv
package main

import (
	"flag"
	"fmt"
	"os"
	"time"
)

func env() Config {
	return Config{
		API: os.Getenv("BM_API"), Region: orDefault(os.Getenv("BM_REGION"), "ap-southeast-2"),
		ClientID: os.Getenv("BM_CLIENT"), User: os.Getenv("BM_USER"), Pass: os.Getenv("BM_PASS"), Code: os.Getenv("BM_CODE"),
	}
}

func orDefault(a, b string) string {
	if a == "" {
		return b
	}
	return a
}

func fail(err error) {
	fmt.Fprintln(os.Stderr, "bmctl:", err)
	os.Exit(1)
}

func main() {
	if len(os.Args) < 2 {
		fmt.Fprintln(os.Stderr, "usage: bmctl queue [-n N] | gauges | export -o file.csv")
		os.Exit(2)
	}
	cfg := env()
	if cfg.API == "" {
		fail(fmt.Errorf("set BM_API to the API URL"))
	}
	tok, err := cfg.Token()
	if err != nil {
		fail(err)
	}
	switch os.Args[1] {
	case "queue":
		fs := flag.NewFlagSet("queue", flag.ExitOnError)
		n := fs.Int("n", 15, "how many incidents")
		_ = fs.Parse(os.Args[2:])
		incs, err := cfg.Incidents(tok)
		if err != nil {
			fail(err)
		}
		Queue(os.Stdout, incs, *n, time.Now())
	case "gauges":
		gs, err := cfg.Gauges(tok)
		if err != nil {
			fail(err)
		}
		Gauges(os.Stdout, gs)
	case "export":
		fs := flag.NewFlagSet("export", flag.ExitOnError)
		out := fs.String("o", "baadhmitra-incidents.csv", "output file")
		_ = fs.Parse(os.Args[2:])
		incs, err := cfg.Incidents(tok)
		if err != nil {
			fail(err)
		}
		f, err := os.Create(*out)
		if err != nil {
			fail(err)
		}
		defer f.Close()
		if err := WriteCSV(f, incs); err != nil {
			fail(err)
		}
		fmt.Printf("wrote %d incidents to %s\n", len(incs), *out)
	default:
		fail(fmt.Errorf("unknown command %q", os.Args[1]))
	}
}
