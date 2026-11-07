package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
)

// Fields mirror shared/types.ts (Inc, Gauge). Only what the terminal shows.
type Inc struct {
	ID     string   `json:"id"`
	Place  string   `json:"place"`
	Score  int      `json:"score"`
	N      int      `json:"n"`
	Ppl    int      `json:"ppl"`
	Sev    int      `json:"sev"`
	Vul    bool     `json:"vul"`
	Needs  []string `json:"needs"`
	Status string   `json:"status"`
	Team   string   `json:"team"`
	First  int64    `json:"first"`
	Last   int64    `json:"last"`
	Opn    int64    `json:"opn"`
	Asg    int64    `json:"asg"`
	Res    int64    `json:"res"`
}

type Gauge struct {
	Name   string  `json:"name"`
	River  string  `json:"river"`
	Lvl    float64 `json:"lvl"`
	Danger float64 `json:"danger"`
	State  string  `json:"state"`
	Trend  float64 `json:"trend"`
	Stale  bool    `json:"stale"`
	Sim    bool    `json:"sim"`
}

func (c Config) get(tok, path string, into any) error {
	req, _ := http.NewRequest("GET", strings.TrimRight(c.API, "/")+path, nil)
	req.Header.Set("authorization", tok)
	res, err := client.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	b, _ := io.ReadAll(io.LimitReader(res.Body, 8<<20))
	switch res.StatusCode {
	case 200:
	case 401, 403:
		return fmt.Errorf("not allowed (%d): your role may not read this", res.StatusCode)
	default:
		return fmt.Errorf("server said %d", res.StatusCode)
	}
	return json.Unmarshal(b, into)
}

func (c Config) Incidents(tok string) ([]Inc, error) {
	var o struct {
		Items []Inc `json:"items"`
	}
	err := c.get(tok, "/incidents", &o)
	return o.Items, err
}

func (c Config) Gauges(tok string) ([]Gauge, error) {
	var o struct {
		Items []Gauge `json:"items"`
	}
	err := c.get(tok, "/gauges", &o)
	return o.Items, err
}
