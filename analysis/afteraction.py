"""After-action report from a BaadhMitra incident CSV (dashboard "Download incident list" or `bmctl export -all`).

    python3 analysis/afteraction.py incidents.csv > report.md

Standard library only. Answers: how long did people wait, who closed incidents, which were overdue, and how sure
can we be given how few incidents there were. Small samples get wide intervals and a warning, not a confident number.
"""
import csv
import random
import statistics
import sys
from datetime import datetime, timezone


def when(s):
    """ISO time -> datetime, or None for an empty or unreadable cell."""
    s = (s or "").strip()
    if not s:
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00")).astimezone(timezone.utc)
    except ValueError:
        return None


def mins(a, b):
    """Minutes from a to b; None if either is missing or the order is impossible."""
    if a is None or b is None or b < a:
        return None
    return (b - a).total_seconds() / 60


def pct(xs, p):
    """Linear-interpolated percentile (p in 0..100) of a non-empty list."""
    s = sorted(xs)
    k = (len(s) - 1) * p / 100
    lo = int(k)
    hi = min(lo + 1, len(s) - 1)
    return s[lo] + (s[hi] - s[lo]) * (k - lo)


def boot_median(xs, n=2000, seed=7):
    """95% bootstrap interval for the median. Needs at least 5 values, otherwise returns None."""
    if len(xs) < 5:
        return None
    rnd = random.Random(seed)
    meds = sorted(statistics.median(rnd.choices(xs, k=len(xs))) for _ in range(n))
    return meds[int(0.025 * n)], meds[int(0.975 * n) - 1]


def load(path):
    with open(path, newline="", encoding="utf-8-sig") as f:
        return list(csv.DictReader(f))


def analyse(rows):
    out = {"n": len(rows)}
    out["status"] = {}
    for r in rows:
        out["status"][r.get("status", "?")] = out["status"].get(r.get("status", "?"), 0) + 1
    assign, resolve, waiting = [], [], []
    for r in rows:
        opened = when(r.get("opened")) or when(r.get("first_report"))
        m = mins(opened, when(r.get("assigned")))
        if m is not None:
            assign.append(m)
        m = mins(opened, when(r.get("resolved")))
        if m is not None:
            resolve.append(m)
        if r.get("status") == "open" and opened:
            waiting.append((r.get("place", ""), opened))
    out["assign"] = assign
    out["resolve"] = resolve
    out["closed_by"] = {k: sum(1 for r in rows if r.get("closed_by") == k) for k in ("team", "control")}
    out["overdue"] = sum(1 for r in rows if r.get("overdue") == "overdue")
    out["warning"] = sum(1 for r in rows if r.get("overdue") == "warning")
    out["waiting"] = waiting
    sev = {}
    for r in rows:
        opened = when(r.get("opened")) or when(r.get("first_report"))
        m = mins(opened, when(r.get("assigned")))
        if m is not None and (r.get("severity") or "").isdigit():
            sev.setdefault(int(r["severity"]), []).append(m)
    out["by_sev"] = sev
    return out


def line(name, xs):
    if not xs:
        return f"| {name} | 0 | - | - | - |"
    ci = boot_median(xs)
    c = f"{ci[0]:.0f}-{ci[1]:.0f}" if ci else "too few"
    return f"| {name} | {len(xs)} | {statistics.median(xs):.0f} | {pct(xs, 90):.0f} | {c} |"


def report(rows, name="input"):
    a = analyse(rows)
    L = [f"# After-action report", "", f"Source: `{name}`. {a['n']} incidents.", ""]
    if a["n"] < 30:
        L += [f"> **Small sample ({a['n']} incidents).** Treat these as a description of this event, not as a general result. Intervals are wide on purpose.", ""]
    L += ["| Status | Incidents |", "| --- | --- |"] + [f"| {k} | {v} |" for k, v in sorted(a["status"].items())] + [""]
    L += ["Times in minutes, from when an incident last became open.", "", "| Measure | n | median | p90 | 95% interval for the median |", "| --- | --- | --- | --- | --- |", line("until a crew was assigned", a["assign"]), line("until resolved", a["resolve"]), ""]
    if a["by_sev"]:
        L += ["| Severity | n | median | p90 | 95% interval for the median |", "| --- | --- | --- | --- | --- |"] + [line(f"severity {k}: until assigned", v) for k, v in sorted(a["by_sev"].items(), reverse=True)] + [""]
    cb = a["closed_by"]
    if cb["team"] + cb["control"]:
        L += [f"Closed by the field team: {cb['team']}. Closed by the control room: {cb['control']}.", ""]
    L += [f"Overdue when the file was taken: {a['overdue']}. Past the warning mark: {a['warning']}.", ""]
    if a["waiting"]:
        w = sorted(a["waiting"], key=lambda x: x[1])[:5]
        L += ["Longest-waiting open incidents (oldest first):", ""] + [f"- {p or '(no place)'}: open since {t.strftime('%Y-%m-%d %H:%M')} UTC" for p, t in w] + [""]
    L += ["Caveat: times come from the dashboard's own timestamps, so they show how long the system knew about an incident, not how long the family waited.", ""]
    return "\n".join(L)


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("usage: python3 analysis/afteraction.py incidents.csv")
    print(report(load(sys.argv[1]), sys.argv[1]))
