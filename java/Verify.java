import java.nio.file.*;
import java.util.*;

/** Replays conformance/vectors.tsv (written by the TypeScript) against the Java code; exits 1 on any difference. */
public final class Verify {
    public static void main(String[] args) throws Exception {
        int ok = 0, bad = 0;
        Map<String, Integer> seen = new TreeMap<>();
        for (String line : Files.readAllLines(Path.of(args.length > 0 ? args[0] : "conformance/vectors.tsv"))) {
            String[] c = line.split("\t");
            boolean good;
            switch (c[0]) {
                case "score" -> {
                    Set<String> needs = c[5].equals("-") ? Set.of() : new HashSet<>(Arrays.asList(c[5].split(",")));
                    good = Priority.score(Integer.parseInt(c[1]), Integer.parseInt(c[2]), Double.parseDouble(c[3]), c[4].equals("1"), needs, Long.parseLong(c[6]), c[7], Long.parseLong(c[8])) == Integer.parseInt(c[9]);
                }
                case "geo" -> {
                    String h = Geohash.encode(Double.parseDouble(c[1]), Double.parseDouble(c[2]), Integer.parseInt(c[3]));
                    double[] m = Geohash.centre(h);
                    good = h.equals(c[4]) && m[0] == Double.parseDouble(c[5]) && m[1] == Double.parseDouble(c[6]);
                }
                case "pct" -> {
                    double[] a = c[2].equals("-") ? new double[0] : Arrays.stream(c[2].split(",")).mapToDouble(Double::parseDouble).toArray();
                    Double got = Stats.percentile(a, Double.parseDouble(c[1]));
                    good = c[3].equals("-") ? got == null : got != null && got == Double.parseDouble(c[3]);
                }
                default -> { continue; }
            }
            seen.merge(c[0], 1, Integer::sum);
            if (good) ok++;
            else { bad++; if (bad <= 10) System.err.println("MISMATCH " + line); }
        }
        System.out.println(ok + "/" + (ok + bad) + " vectors match " + seen);
        if (bad > 0 || ok < 1100) System.exit(1);
    }
}
