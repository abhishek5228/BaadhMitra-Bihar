using System.Text.Json;
using BaadhMitra;

// Replays conformance/vectors.json (written by the TypeScript code) against the C# port.
// Exit code 0 only if every vector matches. No test framework, just the base library.
var path = args.Length > 0 ? args[0] : Path.Combine(AppContext.BaseDirectory, "../../../../../conformance/vectors.json");
using var doc = JsonDocument.Parse(File.ReadAllText(path));
var root = doc.RootElement;
int bad = 0, total = 0;

void Check(string kind, int idx, bool ok, string detail)
{
    total++;
    if (ok) return;
    bad++;
    if (bad <= 10) Console.Error.WriteLine($"MISMATCH {kind}[{idx}]: {detail}");
}

long L(JsonElement e, string k) => e.GetProperty(k).GetInt64();
long? NL(JsonElement e, string k) => e.GetProperty(k).ValueKind == JsonValueKind.Null ? null : e.GetProperty(k).GetInt64();

int i = 0;
foreach (var c in root.GetProperty("score").EnumerateArray())
{
    var x = c.GetProperty("in");
    var needs = x.GetProperty("needs").EnumerateArray().Select(n => n.GetString()!).ToList();
    int got = Priority.Score(x.GetProperty("sev").GetInt32(), x.GetProperty("n").GetInt32(), x.GetProperty("ppl").GetDouble(),
        x.GetProperty("vul").GetBoolean(), needs, L(x, "last"), x.GetProperty("status").GetString()!, L(c, "now"));
    int want = c.GetProperty("out").GetInt32();
    Check("score", i++, got == want, $"{x} -> got {got}, want {want}");
}

i = 0;
foreach (var c in root.GetProperty("sla").EnumerateArray())
{
    var x = c.GetProperty("in");
    var got = Sla.Check(x.GetProperty("status").GetString()!, x.GetProperty("score").GetInt32(), L(x, "first"), NL(x, "opn"), NL(x, "asg"), NL(x, "fts"), L(x, "last"), L(c, "now"));
    var o = c.GetProperty("out");
    string? why = o.GetProperty("why").ValueKind == JsonValueKind.Null ? null : o.GetProperty("why").GetString();
    bool ok = got.Lvl == o.GetProperty("lvl").GetInt32() && got.Why == why && got.Mins == o.GetProperty("mins").GetInt64();
    Check("sla", i++, ok, $"{x} -> got {got}, want {o}");
}

i = 0;
foreach (var c in root.GetProperty("trend").EnumerateArray())
{
    var x = c.GetProperty("in");
    double? got = Trend.HoursToDanger(x.GetProperty("lvl").GetDouble(), x.GetProperty("danger").GetDouble(), x.GetProperty("trend").GetDouble(), x.GetProperty("stale").GetBoolean());
    var o = c.GetProperty("out");
    double? want = o.ValueKind == JsonValueKind.Null ? null : o.GetDouble();
    Check("trend", i++, got == want, $"{x} -> got {got}, want {want}");
}

i = 0;
foreach (var c in root.GetProperty("suggest").EnumerateArray())
{
    var x = c.GetProperty("in");
    var inc = x.GetProperty("inc");
    var crews = x.GetProperty("teams").EnumerateArray().Select(t => new Crew(
        t.GetProperty("id").GetString()!,
        t.GetProperty("lat").ValueKind == JsonValueKind.Null ? null : t.GetProperty("lat").GetDouble(),
        t.GetProperty("lon").GetDouble(), L(t, "ts"), t.GetProperty("busy").GetBoolean())).ToList();
    var got = Dispatch.Suggest(inc.GetProperty("lat").GetDouble(), inc.GetProperty("lon").GetDouble(), crews, L(c, "now"), x.GetProperty("max").GetInt32());
    var want = c.GetProperty("out").EnumerateArray().ToList();
    bool ok = got.Count == want.Count;
    for (int k = 0; ok && k < got.Count; k++)
        ok = got[k].Id == want[k].GetProperty("id").GetString() && got[k].Km == want[k].GetProperty("km").GetDouble()
            && got[k].Eta == want[k].GetProperty("eta").GetDouble() && got[k].Busy == want[k].GetProperty("busy").GetBoolean()
            && got[k].Stale == want[k].GetProperty("stale").GetBoolean();
    Check("suggest", i++, ok, $"got [{string.Join("; ", got)}], want {c.GetProperty("out")}");
}

Console.WriteLine($"{total - bad}/{total} vectors match");
return bad == 0 ? 0 : 1;
