package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func fakeIDP(t *testing.T, mfa bool) *httptest.Server {
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		target := r.Header.Get("x-amz-target")
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		switch {
		case strings.HasSuffix(target, "InitiateAuth"):
			p := body["AuthParameters"].(map[string]any)
			if p["PASSWORD"] != "good" {
				w.WriteHeader(400)
				_, _ = w.Write([]byte(`{"__type":"NotAuthorizedException","message":"Incorrect username or password."}`))
				return
			}
			if mfa {
				_, _ = w.Write([]byte(`{"ChallengeName":"SOFTWARE_TOKEN_MFA","Session":"s1"}`))
				return
			}
			_, _ = w.Write([]byte(`{"AuthenticationResult":{"IdToken":"TOK"}}`))
		case strings.HasSuffix(target, "RespondToAuthChallenge"):
			c := body["ChallengeResponses"].(map[string]any)
			if c["SOFTWARE_TOKEN_MFA_CODE"] != "123456" {
				w.WriteHeader(400)
				_, _ = w.Write([]byte(`{"__type":"CodeMismatchException","message":"Invalid code"}`))
				return
			}
			_, _ = w.Write([]byte(`{"AuthenticationResult":{"IdToken":"TOK"}}`))
		}
	}))
}

func TestTokenPlainAndWrongPassword(t *testing.T) {
	s := fakeIDP(t, false)
	defer s.Close()
	c := Config{IDP: s.URL, ClientID: "c", User: "u", Pass: "good"}
	if tok, err := c.Token(); err != nil || tok != "TOK" {
		t.Fatalf("got %q %v", tok, err)
	}
	c.Pass = "bad"
	if _, err := c.Token(); err == nil || !strings.Contains(err.Error(), "Incorrect") {
		t.Fatalf("want the server's message, got %v", err)
	}
}

func TestTokenTwoStep(t *testing.T) {
	s := fakeIDP(t, true)
	defer s.Close()
	c := Config{IDP: s.URL, ClientID: "c", User: "u", Pass: "good"}
	if _, err := c.Token(); err == nil || !strings.Contains(err.Error(), "BM_CODE") {
		t.Fatalf("should ask for a code, got %v", err)
	}
	c.Code = "000000"
	if _, err := c.Token(); err == nil {
		t.Fatal("wrong code must fail")
	}
	c.Code = "123456"
	if tok, err := c.Token(); err != nil || tok != "TOK" {
		t.Fatalf("got %q %v", tok, err)
	}
}

func TestTokenNeedsSettings(t *testing.T) {
	if _, err := (Config{}).Token(); err == nil {
		t.Fatal("empty config must fail before any network call")
	}
}

func TestAPISendsTokenAndHandlesRoles(t *testing.T) {
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("authorization") != "TOK" {
			w.WriteHeader(401)
			return
		}
		if r.URL.Path == "/prod/gauges" {
			w.WriteHeader(403)
			return
		}
		_, _ = w.Write([]byte(`{"items":[{"id":"a","place":"Supaul","score":80,"n":3,"ppl":12,"status":"open","needs":["boat"]}]}`))
	}))
	defer s.Close()
	c := Config{API: s.URL + "/prod/"}
	incs, err := c.Incidents("TOK")
	if err != nil || len(incs) != 1 || incs[0].Place != "Supaul" {
		t.Fatalf("got %v %v", incs, err)
	}
	if _, err := c.Incidents("WRONG"); err == nil || !strings.Contains(err.Error(), "401") {
		t.Fatalf("want 401 error, got %v", err)
	}
	if _, err := c.Gauges("TOK"); err == nil || !strings.Contains(err.Error(), "role") {
		t.Fatalf("want role error, got %v", err)
	}
}

func TestQueueSortsAndAligns(t *testing.T) {
	now := time.UnixMilli(10_000_000)
	var b bytes.Buffer
	Queue(&b, []Inc{{Place: "Patna", Score: 40, Status: "open", First: 10_000_000 - 3_600_000}, {Place: "सुपौल", Score: 90, Status: "assigned", Team: "SDRF", First: 10_000_000 - 600_000, Needs: []string{"boat", "food"}}}, 0, now)
	lines := strings.Split(strings.TrimSpace(b.String()), "\n")
	if len(lines) != 3 || !strings.HasPrefix(lines[1], "90") || !strings.Contains(lines[1], "assigned:SDRF") || !strings.Contains(lines[1], "10m") {
		t.Fatalf("unexpected output:\n%s", b.String())
	}
	if !strings.Contains(lines[2], "1h") {
		t.Fatalf("age missing: %s", lines[2])
	}
	b.Reset()
	Queue(&b, nil, 5, now)
	if !strings.Contains(b.String(), "no open incidents") {
		t.Fatal("empty queue message missing")
	}
}

func TestQueueLimit(t *testing.T) {
	var b bytes.Buffer
	Queue(&b, []Inc{{Place: "a", Score: 1}, {Place: "b", Score: 3}, {Place: "c", Score: 2}}, 2, time.Now())
	if strings.Count(b.String(), "\n") != 3 || strings.Contains(b.String(), " a ") {
		t.Fatalf("limit not applied:\n%s", b.String())
	}
}

func TestGaugesLabelSimulatedAndStale(t *testing.T) {
	var b bytes.Buffer
	Gauges(&b, []Gauge{{Name: "Ghat", Lvl: 46, Danger: 50, Sim: true}, {Name: "Old", Lvl: 40, Danger: 41, Stale: true}})
	out := b.String()
	if !strings.Contains(out, "SIMULATED") || !strings.Contains(out, "STALE") || !strings.Contains(out, "4.00") {
		t.Fatalf("unexpected:\n%s", out)
	}
}

func TestCSVIsSafeForSpreadsheets(t *testing.T) {
	var b bytes.Buffer
	if err := WriteCSV(&b, []Inc{{ID: "x", Place: `=HYPERLINK("http://evil")`, Score: 5, Needs: []string{"boat", "food"}, Vul: true}, {ID: "y", Place: "Rampur, Test"}}); err != nil {
		t.Fatal(err)
	}
	out := b.String()
	if strings.Contains(out, ",=HYPERLINK") || !strings.Contains(out, `'=HYPERLINK`) {
		t.Fatalf("formula not defused:\n%s", out)
	}
	if !strings.Contains(out, `"Rampur, Test"`) || !strings.Contains(out, "boat|food") || !strings.Contains(out, "yes") {
		t.Fatalf("unexpected:\n%s", out)
	}
	if strings.Contains(strings.ToLower(out), "reporter_id") {
		t.Fatal("must not export reporter ids")
	}
}

func TestPadCountsCharactersNotBytes(t *testing.T) {
	if got := pad("सुपौल", 8); len([]rune(got)) != 8 {
		t.Fatalf("got %d runes", len([]rune(got)))
	}
	if got := pad("abcdefghij", 4); got != "abcd" {
		t.Fatalf("got %q", got)
	}
}
