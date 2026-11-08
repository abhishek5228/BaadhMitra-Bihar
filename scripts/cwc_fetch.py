"""Finds and downloads the newest Central Water Commission daily flood bulletin PDF.

  python3 scripts/cwc_fetch.py --out bulletin.pdf [--date 2024-09-03] [--days 3]

CWC does not publish a fixed link. Past bulletins have been named cfcrcwcdfbDD.MM.YYYY.pdf (2024) or cfcrcwcdfbDD-MM-YYYY.pdf (2025), and when a file is
uploaded again the site adds _0, _1, _2... so the highest suffix that exists is the newest upload. This tries today
and then back through --days, and exits 3 (not 0) when nothing is found so a scheduler can tell "no bulletin" from
"worked". The names are patterns seen in past bulletins, not a promise; if CWC changes them this finds nothing
and says so, it never saves a page that is not a PDF.
"""
import argparse
import sys
import urllib.error
import urllib.request
from datetime import date, datetime, timedelta

BASE = "https://cwc.gov.in/sites/default/files/"
MAX_SUFFIX = 6


def candidates(d):
    """File names to try for one date, plainest first, then the re-uploads in order."""
    out = []
    for sep in (".", "-"):  # 2024 bulletins use dots, a 2025 one uses dashes
        stem = f"cfcrcwcdfb{d.day:02d}{sep}{d.month:02d}{sep}{d.year}"
        out += [stem + ".pdf"] + [f"{stem}_{n}.pdf" for n in range(MAX_SUFFIX + 1)]
    return out


def why(msg):
    print("  " + msg, file=sys.stderr)


def get(url, timeout=25):
    """The bytes if the URL answers with a PDF, otherwise None. Says why on stderr, except for a plain 404 (a name that does not exist is normal)."""
    req = urllib.request.Request(url, headers={"User-Agent": "baadhmitra-feed (public bulletin reader)"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            body = r.read(15_000_000)
    except urllib.error.HTTPError as e:
        if e.code != 404:
            why(f"{url}: HTTP {e.code}")
        return None
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        why(f"{url}: {type(e).__name__} {getattr(e, 'reason', e)}")
        return None
    if body[:5] != b"%PDF-":
        why(f"{url}: answered, but not a PDF ({len(body)} bytes)")
        return None
    return body


def newest_for(d, fetch=get):
    """(url, bytes) of the highest-suffixed bulletin that exists for the date, or None."""
    best = None
    for name in candidates(d):
        body = fetch(BASE + name)
        if body:
            best = (BASE + name, body)
    return best


def find(start, days, fetch=get):
    for k in range(days + 1):
        d = start - timedelta(days=k)
        hit = newest_for(d, fetch)
        if hit:
            return d, hit[0], hit[1]
    return None


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--date", help="YYYY-MM-DD, default today (India)")
    ap.add_argument("--days", type=int, default=3, help="how many earlier days to try")
    a = ap.parse_args(argv)
    start = datetime.strptime(a.date, "%Y-%m-%d").date() if a.date else (datetime.utcnow() + timedelta(hours=5, minutes=30)).date()
    hit = find(start, a.days)
    if not hit:
        print(f"no bulletin found for {start} or the {a.days} days before", file=sys.stderr)
        return 3
    d, url, body = hit
    with open(a.out, "wb") as f:
        f.write(body)
    print(f"{d}: {url} ({len(body)} bytes)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
