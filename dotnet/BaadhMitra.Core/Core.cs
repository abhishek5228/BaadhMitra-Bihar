namespace BaadhMitra;

// C# port of the pure decision logic in shared/*.ts. The deployed system runs the TypeScript;
// this port exists so .NET systems can reuse the same rules, and conformance/vectors.json
// (generated from the TypeScript) proves both give identical answers.

/// <summary>JavaScript's Math.round: halves go towards +infinity (C#'s default rounds them to even).</summary>
internal static class Js
{
    public static double Round(double x) => Math.Floor(x + 0.5);
}

public static class Geo
{
    /// <summary>Great-circle distance in km.</summary>
    public static double Hav(double a, double b, double c, double d)
    {
        const double r = Math.PI / 180;
        double dl = (c - a) * r, dn = (d - b) * r;
        double x = Math.Pow(Math.Sin(dl / 2), 2) + Math.Cos(a * r) * Math.Cos(c * r) * Math.Pow(Math.Sin(dn / 2), 2);
        return 6371 * 2 * Math.Asin(Math.Sqrt(x));
    }
}

public static class Priority
{
    /// <summary>Priority score 0..100 (shared/score.ts).</summary>
    public static int Score(int sev, int n, double ppl, bool vul, IReadOnlyCollection<string> needs, long last, string status, long now)
    {
        if (status is "resolved" or "dismissed") return 0;
        double s = sev * 13;
        s += Math.Min(14, Math.Log2(n + 1) * 5);
        s += Math.Min(10, ppl / 4);
        if (vul) s += 6;
        if (needs.Contains("medical")) s += 5;
        double age = Math.Max(0, now - last) / 3_600_000.0;
        s *= 1 - Math.Min(0.35, age / 48 * 0.35);
        if (status == "assigned") s *= 0.7;
        return (int)Math.Max(0, Math.Min(100, Js.Round(s)));
    }
}

public readonly record struct SlaResult(int Lvl, string? Why, long Mins);

public static class Sla
{
    static long MinFloor(long ms) => ms <= 0 ? 0 : ms / 60000;

    /// <summary>How long has this incident waited, and is that too long? (shared/sla.ts)</summary>
    public static SlaResult Check(string status, int score, long first, long? opn, long? asg, long? fts, long last, long now)
    {
        if (status == "open")
        {
            long m = MinFloor(now - (opn ?? first));
            var (w, b) = score >= 75 ? (15, 30) : (30, 60);
            return new(m >= b ? 2 : m >= w ? 1 : 0, "unassigned", m);
        }
        if (status == "assigned")
        {
            long m = MinFloor(now - (fts ?? asg ?? last));
            return new(m >= 120 ? 2 : m >= 60 ? 1 : 0, "silent", m);
        }
        return new(0, null, 0);
    }
}

public static class Trend
{
    const double MinRise = 0.02;
    const double MaxHours = 48;

    /// <summary>Hours until a rising river reaches its danger mark, or null (shared/trend.ts).</summary>
    public static double? HoursToDanger(double lvl, double danger, double trend, bool stale)
    {
        if (stale || !(trend >= MinRise)) return null;
        double gap = danger - lvl;
        if (gap <= 0) return null;
        double h = gap / trend;
        return h > MaxHours ? null : Js.Round(h * 10) / 10;
    }
}

public record Crew(string Id, double? Lat, double Lon, long Ts, bool Busy);

public record Sug(string Id, double Km, double Eta, bool Busy, bool Stale);

public static class Dispatch
{
    const double Speed = 20;
    const long FreshMs = 30 * 60_000;
    const double BusyPenalty = 60;

    /// <summary>Rank crews by estimated time to reach an incident (shared/suggest.ts). A hint, never an order.</summary>
    public static List<Sug> Suggest(double lat, double lon, IEnumerable<Crew> crews, long now, int max = 3)
    {
        var res = new List<Sug>();
        foreach (var t in crews)
        {
            if (t.Lat is null || !double.IsFinite(t.Lat.Value) || !double.IsFinite(t.Lon) || t.Ts == 0) continue;
            double km = Geo.Hav(lat, lon, t.Lat.Value, t.Lon);
            long age = Math.Max(0, now - t.Ts);
            bool stale = age > FreshMs;
            double eta = km / Speed * 60 + (t.Busy ? BusyPenalty : 0) + (stale ? age / 120_000.0 : 0);
            res.Add(new(t.Id, Js.Round(km * 10) / 10, Js.Round(eta), t.Busy, stale));
        }
        return res.OrderBy(s => s.Eta).ThenBy(s => s.Km).Take(max).ToList();
    }
}
