/** Geohash cell encoding, same as ghash() and gcent() in shared/geo.ts. */
public final class Geohash {
    private Geohash() {}

    private static final String B32 = "0123456789bcdefghjkmnpqrstuvwxyz";

    public static String encode(double lat, double lon, int prec) {
        double[] la = {-90, 90}, lo = {-180, 180};
        StringBuilder out = new StringBuilder();
        int bit = 0, idx = 0;
        boolean even = true;
        while (out.length() < prec) {
            double[] rng = even ? lo : la;
            double val = even ? lon : lat;
            double mid = (rng[0] + rng[1]) / 2;
            if (val >= mid) { idx = idx * 2 + 1; rng[0] = mid; } else { idx = idx * 2; rng[1] = mid; }
            even = !even;
            if (++bit == 5) { out.append(B32.charAt(idx)); bit = 0; idx = 0; }
        }
        return out.toString();
    }

    /** Middle of a cell as {lat, lon}. */
    public static double[] centre(String h) {
        double[] la = {-90, 90}, lo = {-180, 180};
        boolean even = true;
        for (char c : h.toCharArray()) {
            int v = B32.indexOf(c);
            for (int b = 4; b >= 0; b--) {
                double[] rng = even ? lo : la;
                double mid = (rng[0] + rng[1]) / 2;
                if (((v >> b) & 1) == 1) rng[0] = mid; else rng[1] = mid;
                even = !even;
            }
        }
        return new double[] {(la[0] + la[1]) / 2, (lo[0] + lo[1]) / 2};
    }
}
