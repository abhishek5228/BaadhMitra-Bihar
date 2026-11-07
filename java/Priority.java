import java.util.*;

/** Priority score 0..100, same rule as shared/score.ts, for JVM systems (the kind a state data centre runs). */
public final class Priority {
    private Priority() {}

    public static int score(int sev, int n, double ppl, boolean vul, Set<String> needs, long last, String status, long now) {
        if (status.equals("resolved") || status.equals("dismissed")) return 0;
        double s = sev * 13;
        s += Math.min(14, Math.log(n + 1) / Math.log(2) * 5);
        s += Math.min(10, ppl / 4);
        if (vul) s += 6;
        if (needs.contains("medical")) s += 5;
        double age = Math.max(0, now - last) / 3_600_000.0;
        s *= 1 - Math.min(0.35, age / 48 * 0.35);
        if (status.equals("assigned")) s *= 0.7;
        return (int) Math.max(0, Math.min(100, Math.floor(s + 0.5)));
    }
}
