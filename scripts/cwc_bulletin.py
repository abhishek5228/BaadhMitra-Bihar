"""Reads a Central Water Commission daily flood bulletin (PDF) and writes the Bihar readings in the feed shape
the gauge poller understands: [{id, name, river, lat, lon, lvl, danger, ts}].

  python3 scripts/cwc_bulletin.py bulletin.pdf --out data/cwc-latest.json --meta data/cwc-latest.meta.json

What the bulletin is, and is not:
  * It lists only the sites at or above their WARNING level (sections A, B and C). A site below warning is not in
    it at all, so its level is unknown and is never invented here.
  * It is issued once a day. The actual level is the 14:00-ish observation printed in the table, on the bulletin date.
  * Only stations found in docs/cwc-bihar-stations.json are written, because the feed needs coordinates and the
    bulletin has none. Other stations are counted in `skipped`, never guessed.
"""
import argparse
import glob
import json
import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pdfplumber

IST = timezone(timedelta(hours=5, minutes=30))


def norm(s):
    return re.sub(r"[^a-z0-9]", "", (s or "").lower())


def num(s):
    try:
        return float(str(s).replace(",", "").strip())
    except (TypeError, ValueError):
        return None


def load_table(path):
    """station key -> (id, entry). The key is the station name before any comma ("Gandhighat, Patna" -> gandhighat)."""
    doc = json.loads(Path(path).read_text(encoding="utf-8"))
    return {norm(e["name"].split(",")[0]): (sid, e) for sid, e in doc["stations"].items()}


def bulletin_date(pdf):
    """The date and number printed on the first page, or (None, None)."""
    text = pdf.pages[0].extract_text() or ""
    d = re.search(r"Date\s*:?\s*(\d{2})/(\d{2})/(\d{4})", text)
    n = re.search(r"Bulletin\s*No\s*:?\s*(\d+)", text)
    date = datetime(int(d.group(3)), int(d.group(2)), int(d.group(1))).date() if d else None
    return date, int(n.group(1)) if n else None


def bihar_expected(pdf):
    """How many Bihar sites the summary on page 1 says are above warning (e.g. "Bihar(8)" in B plus "Bihar(9)" in C), or None."""
    text = (pdf.pages[0].extract_text() or "").replace("\n", " ")
    found = [int(n) for n in re.findall(r"Bihar\s*\((\d+)\)", text)]
    return sum(found) if found else (0 if re.search(r"Total number of sites above Warning Level", text) else None)


def stations(pdf):
    """Yield one dict per station block. Each block is four table rows: values, name/state/HFL date/trend, magnitude/forecast date, times."""
    for page in pdf.pages:
        for tb in page.extract_tables():
            i = 0
            while i < len(tb):
                r = tb[i]
                if r and r[0] and str(r[0]).strip().isdigit() and num(r[3]) is not None and num(r[6]) is not None:
                    r1 = tb[i + 1] if i + 1 < len(tb) else [None] * 8
                    r3 = tb[i + 3] if i + 3 < len(tb) else [None] * 8
                    yield {
                        "river": (r[1] or "").strip(),
                        "district": (r[2] or "").strip(),
                        "warn": num(r[3]),
                        "danger": num(r[4]),
                        "hfl": num(r[5]),
                        "lvl": num(r[6]),
                        "station": (r1[1] or "").strip(),
                        "state": (r1[2] or "").strip(),
                        "time": (r3[6] or "").strip(),
                    }
                    i += 4
                else:
                    i += 1


def obs_ms(date, hhmm):
    """Observation time as epoch milliseconds, read as Indian Standard Time. Falls back to 14:00 if the time is unreadable."""
    m = re.match(r"(\d{1,2}):(\d{2})", hhmm or "")
    h, mi = (int(m.group(1)), int(m.group(2))) if m else (14, 0)
    return int(datetime(date.year, date.month, date.day, h, mi, tzinfo=IST).timestamp() * 1000)


def parse(path, table_path):
    table = load_table(table_path)
    rows, skipped, warnings = [], [], []
    with pdfplumber.open(path) as pdf:
        date, no = bulletin_date(pdf)
        if date is None:
            raise ValueError("no bulletin date found: not a CWC flood bulletin?")
        seen = 0
        for s in stations(pdf):
            seen += s["state"].lower() == "bihar"
            hit = table.get(norm(s["station"]))
            if s["state"].lower() != "bihar" or hit is None:
                skipped.append(f'{s["station"]} ({s["state"]})')
                continue
            sid, e = hit
            if abs(s["danger"] - e["danger"]) > 0.005:
                warnings.append(f'{s["station"]}: bulletin danger {s["danger"]} differs from table {e["danger"]}; bulletin used')
            rows.append({
                "id": sid, "name": e["name"], "river": e["river"], "lat": e["lat"], "lon": e["lon"],
                "lvl": s["lvl"], "danger": s["danger"], "ts": obs_ms(date, s["time"]),
            })
        want = bihar_expected(pdf)
        if want is not None and want != seen:
            # The summary and the tables disagree: the layout has probably changed. Fail loudly, never publish a quiet "all clear".
            raise ValueError(f"page 1 counts {want} Bihar sites above warning but {seen} were read from the tables")
    meta = {"bulletin_date": date.isoformat(), "bulletin_no": no, "stations": len(rows), "skipped": skipped, "warnings": warnings}
    return rows, meta


def newest(paths, table_path):
    """Read every PDF and return (path, rows, meta) of the newest bulletin by date, then number. Files that are not bulletins are named and skipped."""
    best = None
    for p in sorted(paths):
        try:
            rows, meta = parse(p, table_path)
        except Exception as e:  # not a bulletin, or the layout changed: say which file and carry on with the others
            print(f"skipped {p}: {e}", file=sys.stderr)
            continue
        key = (meta["bulletin_date"], meta["bulletin_no"] or 0)
        if best is None or key >= best[0]:
            best = (key, p, rows, meta)
    if best is None:
        raise ValueError("none of the PDFs could be read as a CWC bulletin")
    return best[1], best[2], best[3]


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("pdf", nargs="+", help="one or more bulletins; the newest by date is used")
    ap.add_argument("--table", default="docs/cwc-bihar-stations.json")
    ap.add_argument("--out", required=True)
    ap.add_argument("--meta")
    a = ap.parse_args(argv)
    files = [f for pat in a.pdf for f in (sorted(glob.glob(pat)) if any(c in pat for c in '*?[') else [pat])]  # Windows CMD does not expand wildcards
    path, rows, meta = newest(files, a.table)
    Path(a.out).write_text(json.dumps(rows, indent=1) + "\n", encoding="utf-8")
    if a.meta:
        Path(a.meta).write_text(json.dumps(meta, indent=1) + "\n", encoding="utf-8")
    print(f'{path}: bulletin {meta["bulletin_no"]} of {meta["bulletin_date"]}: {len(rows)} Bihar stations, {len(meta["skipped"])} skipped')
    return 0


if __name__ == "__main__":
    sys.exit(main())
