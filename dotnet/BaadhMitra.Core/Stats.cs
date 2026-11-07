namespace BaadhMitra;

public static class Stats
{
    /// <summary>Nearest-rank percentile of response times, one decimal; null for an empty list (q() in shared/sla.ts).</summary>
    public static double? Percentile(IReadOnlyCollection<double> a, double p)
    {
        if (a.Count == 0) return null;
        var s = a.Order().ToArray();
        return Js.Round(s[Math.Min(s.Length - 1, (int)Math.Floor(p * s.Length))] * 10) / 10;
    }
}
