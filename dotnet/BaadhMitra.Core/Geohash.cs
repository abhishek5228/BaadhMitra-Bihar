using System.Text;

namespace BaadhMitra;

/// <summary>Geohash cells, same as ghash() and gcent() in shared/geo.ts. Precision 5 is about 4.9 km across.</summary>
public static class Geohash
{
    const string B32 = "0123456789bcdefghjkmnpqrstuvwxyz";

    public static string Encode(double lat, double lon, int prec = 5)
    {
        double[] la = { -90, 90 }, lo = { -180, 180 };
        var sb = new StringBuilder();
        int bit = 0, idx = 0;
        bool even = true;
        while (sb.Length < prec)
        {
            var rng = even ? lo : la;
            double val = even ? lon : lat, mid = (rng[0] + rng[1]) / 2;
            if (val >= mid) { idx = idx * 2 + 1; rng[0] = mid; } else { idx *= 2; rng[1] = mid; }
            even = !even;
            if (++bit == 5) { sb.Append(B32[idx]); bit = 0; idx = 0; }
        }
        return sb.ToString();
    }

    public static (double Lat, double Lon) Centre(string h)
    {
        double[] la = { -90, 90 }, lo = { -180, 180 };
        bool even = true;
        foreach (char c in h)
        {
            int v = B32.IndexOf(c);
            for (int b = 4; b >= 0; b--)
            {
                var rng = even ? lo : la;
                double mid = (rng[0] + rng[1]) / 2;
                if (((v >> b) & 1) == 1) rng[0] = mid; else rng[1] = mid;
                even = !even;
            }
        }
        return ((la[0] + la[1]) / 2, (lo[0] + lo[1]) / 2);
    }
}
