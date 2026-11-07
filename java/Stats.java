import java.util.Arrays;

/** Nearest-rank percentile of response times (q() in shared/sla.ts). */
public final class Stats {
    private Stats() {}

    /** Rounded to one decimal; null for an empty list. */
    public static Double percentile(double[] a, double p) {
        if (a.length == 0) return null;
        double[] s = a.clone();
        Arrays.sort(s);
        int i = Math.min(s.length - 1, (int) Math.floor(p * s.length));
        return Math.floor(s[i] * 10 + 0.5) / 10;
    }
}
