import java.nio.file.*;
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

    /** Replays the score rows of conformance/vectors.tsv; exits 1 on any difference. */
    public static void main(String[] args) throws Exception {
        int ok = 0, bad = 0;
        for (String line : Files.readAllLines(Path.of(args.length > 0 ? args[0] : "conformance/vectors.tsv"))) {
            String[] c = line.split("\t");
            if (!c[0].equals("score")) continue;
            Set<String> needs = c[5].equals("-") ? Set.of() : new HashSet<>(Arrays.asList(c[5].split(",")));
            int got = score(Integer.parseInt(c[1]), Integer.parseInt(c[2]), Double.parseDouble(c[3]), c[4].equals("1"), needs, Long.parseLong(c[6]), c[7], Long.parseLong(c[8]));
            if (got == Integer.parseInt(c[9])) ok++;
            else { bad++; if (bad <= 10) System.err.println("MISMATCH " + line + " -> " + got); }
        }
        System.out.println(ok + "/" + (ok + bad) + " score vectors match");
        if (bad > 0 || ok != 700) System.exit(1);
    }
}
