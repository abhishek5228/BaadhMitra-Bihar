import json
import pathlib
import unittest

from baadhmitra import centre, geohash, hours_to_danger, percentile, score, sla, suggest

V = json.loads((pathlib.Path(__file__).resolve().parents[2] / "conformance" / "vectors.json").read_text())


class Vectors(unittest.TestCase):
    def test_score(self):
        for c in V["score"]:
            i = c["in"]
            self.assertEqual(score(i["sev"], i["n"], i["ppl"], i["vul"], i["needs"], i["last"], i["status"], c["now"]), c["out"], c)

    def test_sla(self):
        for c in V["sla"]:
            i, o = c["in"], c["out"]
            self.assertEqual(sla(i["status"], i["score"], i["first"], i["opn"], i["asg"], i["fts"], i["last"], c["now"]), (o["lvl"], o["why"], o["mins"]), c)

    def test_trend(self):
        for c in V["trend"]:
            i = c["in"]
            self.assertEqual(hours_to_danger(i["lvl"], i["danger"], i["trend"], i["stale"]), c["out"], c)

    def test_suggest(self):
        for c in V["suggest"]:
            i = c["in"]
            self.assertEqual(suggest(i["inc"]["lat"], i["inc"]["lon"], i["teams"], c["now"], i["max"]), c["out"], c)

    def test_geohash(self):
        for c in V["geo"]:
            i, o = c["in"], c["out"]
            h = geohash(i["lat"], i["lon"], i["prec"])
            self.assertEqual((h, *centre(h)), (o["hash"], o["lat"], o["lon"]), c)

    def test_percentile(self):
        for c in V["pct"]:
            self.assertEqual(percentile(c["in"]["a"], c["in"]["p"]), c["out"], c)


if __name__ == "__main__":
    unittest.main()
