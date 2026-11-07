"""The decision rules (score, overdue clock, time-to-danger, crew ranking) for analysts working in notebooks.
Standard library only. Same rules as shared/*.ts; tests replay conformance/vectors.json."""
import math

HOUR = 3_600_000


def js_round(x):
    """JavaScript's Math.round: halves go up (Python's round() goes to even)."""
    return math.floor(x + 0.5)


def hav(a, b, c, d):
    r = math.pi / 180
    dl, dn = (c - a) * r, (d - b) * r
    x = math.sin(dl / 2) ** 2 + math.cos(a * r) * math.cos(c * r) * math.sin(dn / 2) ** 2
    return 6371 * 2 * math.asin(math.sqrt(x))


def score(sev, n, ppl, vul, needs, last, status, now):
    if status in ("resolved", "dismissed"):
        return 0
    s = sev * 13
    s += min(14, math.log2(n + 1) * 5)
    s += min(10, ppl / 4)
    if vul:
        s += 6
    if "medical" in needs:
        s += 5
    age = max(0, now - last) / HOUR
    s *= 1 - min(0.35, age / 48 * 0.35)
    if status == "assigned":
        s *= 0.7
    return int(max(0, min(100, js_round(s))))


def _mins(ms):
    return max(0, ms // 60000)


def sla(status, score_, first, opn, asg, fts, last, now):
    """Returns (level 0..2, reason or None, minutes waited). opn/asg/fts may be None."""
    if status == "open":
        m = _mins(now - (opn if opn is not None else first))
        warn, breach = (15, 30) if score_ >= 75 else (30, 60)
        return (2 if m >= breach else 1 if m >= warn else 0, "unassigned", m)
    if status == "assigned":
        ref = fts if fts is not None else asg if asg is not None else last
        m = _mins(now - ref)
        return (2 if m >= 120 else 1 if m >= 60 else 0, "silent", m)
    return (0, None, 0)


def hours_to_danger(lvl, danger, trend, stale):
    if stale or not trend >= 0.02:
        return None
    gap = danger - lvl
    if gap <= 0:
        return None
    h = gap / trend
    return None if h > 48 else js_round(h * 10) / 10


def suggest(lat, lon, crews, now, max_n=3):
    """crews: dicts with id, lat (or None), lon, ts, busy. Returns dicts with id, km, eta, busy, stale."""
    out = []
    for t in crews:
        if t["lat"] is None or not math.isfinite(t["lat"]) or not math.isfinite(t["lon"]) or not t["ts"]:
            continue
        km = hav(lat, lon, t["lat"], t["lon"])
        age = max(0, now - t["ts"])
        stale = age > 30 * 60_000
        eta = km / 20 * 60 + (60 if t["busy"] else 0) + (age / 120_000 if stale else 0)
        out.append({"id": t["id"], "km": js_round(km * 10) / 10, "eta": js_round(eta), "busy": bool(t["busy"]), "stale": stale})
    out.sort(key=lambda s: (s["eta"], s["km"]))  # sort is stable
    return out[:max_n]
