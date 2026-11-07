use baadhmitra_dispatch::{suggest, Crew, Sug};

fn flag(s: &str) -> bool {
    s == "1"
}

#[test]
fn matches_typescript() {
    let text = std::fs::read_to_string("../conformance/vectors.tsv").unwrap();
    let mut n = 0;
    for line in text.lines().filter(|l| l.starts_with("suggest\t")) {
        let c: Vec<&str> = line.split('\t').collect();
        let crews: Vec<Crew> = if c[5] == "-" {
            vec![]
        } else {
            c[5].split(';').map(|t| {
                let p: Vec<&str> = t.split(',').collect();
                Crew { id: p[0].into(), lat: if p[1] == "-" { None } else { Some(p[1].parse().unwrap()) }, lon: p[2].parse().unwrap(), ts: p[3].parse().unwrap(), busy: flag(p[4]) }
            }).collect()
        };
        let want: Vec<Sug> = if c[6] == "-" {
            vec![]
        } else {
            c[6].split(';').map(|t| {
                let p: Vec<&str> = t.split(',').collect();
                Sug { id: p[0].into(), km: p[1].parse().unwrap(), eta: p[2].parse().unwrap(), busy: flag(p[3]), stale: flag(p[4]) }
            }).collect()
        };
        let got = suggest(c[1].parse().unwrap(), c[2].parse().unwrap(), &crews, c[3].parse().unwrap(), c[4].parse().unwrap());
        assert_eq!(got, want, "{line}");
        n += 1;
    }
    assert!(n >= 120);
}

#[test]
fn geohash_matches_typescript() {
    let text = std::fs::read_to_string("../conformance/vectors.tsv").unwrap();
    let mut n = 0;
    for line in text.lines().filter(|l| l.starts_with("geo\t")) {
        let c: Vec<&str> = line.split('\t').collect();
        let h = baadhmitra_dispatch::geohash(c[1].parse().unwrap(), c[2].parse().unwrap(), c[3].parse().unwrap());
        assert_eq!(h, c[4], "{line}");
        let (la, lo) = baadhmitra_dispatch::centre(&h);
        assert_eq!((la, lo), (c[5].parse().unwrap(), c[6].parse().unwrap()), "{line}");
        n += 1;
    }
    assert!(n >= 300);
}

#[test]
fn percentile_matches_typescript() {
    let text = std::fs::read_to_string("../conformance/vectors.tsv").unwrap();
    let mut n = 0;
    for line in text.lines().filter(|l| l.starts_with("pct\t")) {
        let c: Vec<&str> = line.split('\t').collect();
        let a: Vec<f64> = if c[2] == "-" { vec![] } else { c[2].split(',').map(|x| x.parse().unwrap()).collect() };
        let want: Option<f64> = if c[3] == "-" { None } else { Some(c[3].parse().unwrap()) };
        assert_eq!(baadhmitra_dispatch::percentile(&a, c[1].parse().unwrap()), want, "{line}");
        n += 1;
    }
    assert!(n >= 150);
}
