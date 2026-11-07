import os
import tempfile
import unittest
from datetime import datetime, timezone

import afteraction as a

HEAD = "id,place,score,status,team,reporters,people,severity,vulnerable,needs,first_report,opened,assigned,resolved,closed_by,overdue\n"


def row(i, status="resolved", opened="2026-08-01T06:00:00Z", assigned="2026-08-01T06:20:00Z", resolved="2026-08-01T08:00:00Z", by="team", sev=4, od=""):
    return f"{i},Place{i},50,{status},T,2,5,{sev},no,boat,{opened},{opened},{assigned},{resolved},{by},{od}\n"


def parse(txt):
    fd, tmp = tempfile.mkstemp(suffix=".csv")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(txt)
        return a.load(tmp)
    finally:
        os.remove(tmp)


class T(unittest.TestCase):
    def test_when_handles_blank_and_bad(self):
        self.assertIsNone(a.when(""))
        self.assertIsNone(a.when("not a date"))
        self.assertEqual(a.when("2026-08-01T06:00:00Z"), datetime(2026, 8, 1, 6, 0, tzinfo=timezone.utc))

    def test_mins_rejects_impossible_order(self):
        s, e = a.when("2026-08-01T06:00:00Z"), a.when("2026-08-01T06:30:00Z")
        self.assertEqual(a.mins(s, e), 30)
        self.assertIsNone(a.mins(e, s))
        self.assertIsNone(a.mins(None, e))

    def test_percentile(self):
        self.assertEqual(a.pct([1, 2, 3, 4, 5], 50), 3)
        self.assertEqual(a.pct([10], 90), 10)
        self.assertAlmostEqual(a.pct([0, 10], 90), 9)

    def test_bootstrap_needs_five_and_is_repeatable_and_brackets_the_median(self):
        self.assertIsNone(a.boot_median([1, 2, 3, 4]))
        xs = [10, 12, 15, 20, 22, 25, 30, 41, 60]
        lo, hi = a.boot_median(xs)
        self.assertEqual((lo, hi), a.boot_median(xs))
        self.assertLessEqual(lo, 22)
        self.assertGreaterEqual(hi, 22)

    def test_analyse_times_and_closers(self):
        rows = parse(HEAD + row(1) + row(2, by="control") + row(3, status="open", assigned="", resolved="", by="", od="overdue"))
        r = a.analyse(rows)
        self.assertEqual(r["n"], 3)
        self.assertEqual(r["assign"], [20, 20])
        self.assertEqual(r["resolve"], [120, 120])
        self.assertEqual(r["closed_by"], {"team": 1, "control": 1})
        self.assertEqual(r["overdue"], 1)
        self.assertEqual(len(r["waiting"]), 1)

    def test_missing_timestamps_are_skipped_not_zero(self):
        rows = parse(HEAD + row(1, assigned="", resolved=""))
        r = a.analyse(rows)
        self.assertEqual(r["assign"], [])
        self.assertEqual(r["resolve"], [])

    def test_report_warns_on_small_samples_and_shows_no_interval_for_tiny_n(self):
        txt = a.report(parse(HEAD + row(1) + row(2)), "x.csv")
        self.assertIn("Small sample", txt)
        self.assertIn("too few", txt)
        self.assertIn("x.csv", txt)

    def test_report_with_no_rows_does_not_crash(self):
        self.assertIn("0 incidents", a.report([], "empty.csv"))

    def test_by_severity_groups(self):
        rows = parse(HEAD + row(1, sev=5) + row(2, sev=5) + row(3, sev=2, assigned="2026-08-01T07:00:00Z"))
        r = a.analyse(rows)
        self.assertEqual(sorted(r["by_sev"]), [2, 5])
        self.assertEqual(r["by_sev"][2], [60])


if __name__ == "__main__":
    unittest.main()
