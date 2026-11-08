import json
import sys
import unittest
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))

import cwc_bulletin as cb  # noqa: E402
import cwc_fetch as cf  # noqa: E402

FIX = ROOT / "test" / "fixtures" / "cwc"
TABLE = ROOT / "docs" / "cwc-bihar-stations.json"


class Bulletin(unittest.TestCase):
    def test_flood_day_gives_all_bihar_stations_with_the_printed_levels(self):
        rows, meta = cb.parse(FIX / "2024-09-03.pdf", TABLE)
        self.assertEqual((meta["bulletin_no"], meta["bulletin_date"], meta["stations"]), (126, "2024-09-03", 17))
        by = {r["id"]: r for r in rows}
        self.assertEqual((by["baltara"]["lvl"], by["baltara"]["danger"]), (33.99, 33.85))
        self.assertEqual((by["basua"]["lvl"], by["basua"]["danger"]), (46.79, 47.75))
        self.assertEqual(by["kursela"]["river"], "Kosi")
        self.assertEqual(by["gandhighat"]["name"], "Gandhighat, Patna")

    def test_matches_the_golden_file(self):
        rows, _ = cb.parse(FIX / "2024-09-03.pdf", TABLE)
        self.assertEqual(rows, json.loads((FIX / "2024-09-03.expected.json").read_text()))

    def test_other_states_are_skipped_not_guessed(self):
        _, meta = cb.parse(FIX / "2024-09-03.pdf", TABLE)
        self.assertEqual(len(meta["skipped"]), 14)
        self.assertIn("Ballia (Uttar Pradesh)", meta["skipped"])
        self.assertEqual(meta["warnings"], [])

    def test_observation_time_is_14_00_india_time_on_the_bulletin_date(self):
        rows, _ = cb.parse(FIX / "2024-09-03.pdf", TABLE)
        self.assertEqual({r["ts"] for r in rows}, {1725352200000})  # 2024-09-03 08:30 UTC

    def test_a_day_with_no_flood_site_is_an_empty_list(self):
        rows, meta = cb.parse(FIX / "2024-05-13.pdf", TABLE)
        self.assertEqual((rows, meta["stations"], meta["bulletin_date"]), ([], 0, "2024-05-13"))

    def test_something_that_is_not_a_bulletin_is_refused(self):
        with self.assertRaises(Exception):
            cb.parse(ROOT / "README.md", TABLE)

    def test_a_pdf_that_is_not_a_bulletin_is_refused(self):
        with self.assertRaises(ValueError):
            cb.parse(ROOT / "test" / "fixtures" / "cwc" / "not-a-bulletin.pdf", TABLE)

    def test_it_refuses_to_publish_when_the_tables_do_not_match_the_summary(self):
        from unittest import mock

        with mock.patch.object(cb, "stations", return_value=iter(())):
            with self.assertRaises(ValueError) as cm:
                cb.parse(FIX / "2024-09-03.pdf", TABLE)
        self.assertIn("17", str(cm.exception))

    def test_the_summary_count_is_read_from_page_one(self):
        import pdfplumber

        with pdfplumber.open(FIX / "2024-09-03.pdf") as pdf:
            self.assertEqual(cb.bihar_expected(pdf), 17)
        with pdfplumber.open(FIX / "2024-05-13.pdf") as pdf:
            self.assertEqual(cb.bihar_expected(pdf), 0)

    def test_with_several_files_the_newest_bulletin_wins_and_a_bad_file_is_skipped(self):
        paths = [FIX / "2024-05-13.pdf", FIX / "not-a-bulletin.pdf", FIX / "2024-09-03.pdf"]
        path, rows, meta = cb.newest(paths, TABLE)
        self.assertEqual((path.name, meta["bulletin_date"], len(rows)), ("2024-09-03.pdf", "2024-09-03", 17))
        path, rows, _ = cb.newest(list(reversed(paths)), TABLE)
        self.assertEqual(path.name, "2024-09-03.pdf")

    def test_a_wildcard_is_expanded_by_the_script_itself(self):
        import tempfile

        with tempfile.TemporaryDirectory() as d:
            out = Path(d) / "o.json"
            self.assertEqual(cb.main([str(FIX / "2024-0*.pdf"), "--table", str(TABLE), "--out", str(out)]), 0)
            self.assertEqual(len(json.loads(out.read_text())), 17)

    def test_it_fails_when_no_file_is_a_bulletin(self):
        with self.assertRaises(ValueError):
            cb.newest([FIX / "not-a-bulletin.pdf"], TABLE)

    def test_station_names_match_without_punctuation_or_case(self):
        self.assertEqual(cb.norm("Gandhighat, Patna".split(",")[0]), cb.norm(" GANDHIGHAT "))


class Fetch(unittest.TestCase):
    def test_candidate_names_for_a_date(self):
        c = cf.candidates(date(2024, 9, 3))
        self.assertEqual(c[0], "cfcrcwcdfb03.09.2024.pdf")
        self.assertEqual(c[1], "cfcrcwcdfb03.09.2024_0.pdf")
        self.assertIn("cfcrcwcdfb03.09.2024_2.pdf", c)

    def test_the_highest_reupload_wins(self):
        have = {cf.BASE + "cfcrcwcdfb03.09.2024.pdf": b"%PDF-1 old", cf.BASE + "cfcrcwcdfb03.09.2024_2.pdf": b"%PDF-1 new"}
        url, body = cf.newest_for(date(2024, 9, 3), have.get)
        self.assertTrue(url.endswith("_2.pdf"))
        self.assertEqual(body, b"%PDF-1 new")

    def test_falls_back_to_earlier_days_and_reports_none(self):
        have = {cf.BASE + "cfcrcwcdfb01.09.2024.pdf": b"%PDF-1 x"}
        d, url, _ = cf.find(date(2024, 9, 3), 3, have.get)
        self.assertEqual(d, date(2024, 9, 1))
        self.assertIsNone(cf.find(date(2024, 9, 3), 1, {}.get))

    def test_a_response_that_is_not_a_pdf_is_never_saved(self):
        from unittest import mock

        class Resp:
            def __init__(self, body):
                self.body = body

            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

            def read(self, n):
                return self.body

        with mock.patch("urllib.request.urlopen", return_value=Resp(b"<html>Page not found</html>")):
            self.assertIsNone(cf.get("https://cwc.gov.in/x.pdf"))
        with mock.patch("urllib.request.urlopen", return_value=Resp(b"%PDF-1.4 ok")):
            self.assertEqual(cf.get("https://cwc.gov.in/x.pdf"), b"%PDF-1.4 ok")

    def test_a_network_error_is_no_bulletin_not_a_crash(self):
        import urllib.error
        from unittest import mock

        with mock.patch("urllib.request.urlopen", side_effect=urllib.error.URLError("down")):
            self.assertIsNone(cf.get("https://cwc.gov.in/x.pdf"))


if __name__ == "__main__":
    unittest.main()
