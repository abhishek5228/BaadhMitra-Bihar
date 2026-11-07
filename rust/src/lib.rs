//! Crew ranking for an incident: distance and estimated arrival. Same rules as shared/suggest.ts.
//! A hint for the dispatcher, never an order.

const SPEED: f64 = 20.0; // km/h through flooded ground
const FRESH_MS: i64 = 30 * 60_000;
const BUSY_PENALTY: f64 = 60.0;

pub struct Crew {
    pub id: String,
    pub lat: Option<f64>,
    pub lon: f64,
    pub ts: i64,
    pub busy: bool,
}

#[derive(Debug, PartialEq)]
pub struct Sug {
    pub id: String,
    pub km: f64,
    pub eta: f64,
    pub busy: bool,
    pub stale: bool,
}

/// JavaScript's Math.round: halves go up.
fn js_round(x: f64) -> f64 {
    (x + 0.5).floor()
}

/// Great-circle distance in km.
pub fn hav(a: f64, b: f64, c: f64, d: f64) -> f64 {
    let r = std::f64::consts::PI / 180.0;
    let dl = (c - a) * r;
    let dn = (d - b) * r;
    let x = (dl / 2.0).sin().powi(2) + (a * r).cos() * (c * r).cos() * (dn / 2.0).sin().powi(2);
    6371.0 * 2.0 * x.sqrt().asin()
}

pub fn suggest(lat: f64, lon: f64, crews: &[Crew], now: i64, max: usize) -> Vec<Sug> {
    let mut out: Vec<Sug> = Vec::new();
    for t in crews {
        let tlat = match t.lat {
            Some(v) if v.is_finite() && t.lon.is_finite() && t.ts != 0 => v,
            _ => continue,
        };
        let km = hav(lat, lon, tlat, t.lon);
        let age = (now - t.ts).max(0);
        let stale = age > FRESH_MS;
        let eta = km / SPEED * 60.0 + if t.busy { BUSY_PENALTY } else { 0.0 } + if stale { age as f64 / 120_000.0 } else { 0.0 };
        out.push(Sug { id: t.id.clone(), km: js_round(km * 10.0) / 10.0, eta: js_round(eta), busy: t.busy, stale });
    }
    // stable sort: soonest first, then nearest
    out.sort_by(|a, b| a.eta.partial_cmp(&b.eta).unwrap().then(a.km.partial_cmp(&b.km).unwrap()));
    out.truncate(max);
    out
}

const B32: &[u8] = b"0123456789bcdefghjkmnpqrstuvwxyz";

/// Geohash cell name for a position; precision 5 is about 4.9 km across.
pub fn geohash(lat: f64, lon: f64, prec: usize) -> String {
    let (mut la, mut lo) = ([-90.0, 90.0], [-180.0, 180.0]);
    let (mut out, mut bit, mut idx, mut even) = (String::new(), 0, 0usize, true);
    while out.len() < prec {
        let (rng, val) = if even { (&mut lo, lon) } else { (&mut la, lat) };
        let mid = (rng[0] + rng[1]) / 2.0;
        if val >= mid {
            idx = idx * 2 + 1;
            rng[0] = mid;
        } else {
            idx *= 2;
            rng[1] = mid;
        }
        even = !even;
        bit += 1;
        if bit == 5 {
            out.push(B32[idx] as char);
            bit = 0;
            idx = 0;
        }
    }
    out
}

/// Middle of a geohash cell as (lat, lon).
pub fn centre(h: &str) -> (f64, f64) {
    let (mut la, mut lo, mut even) = ([-90.0, 90.0], [-180.0, 180.0], true);
    for c in h.bytes() {
        let v = B32.iter().position(|&x| x == c).unwrap();
        for b in (0..5).rev() {
            let rng = if even { &mut lo } else { &mut la };
            let mid = (rng[0] + rng[1]) / 2.0;
            if (v >> b) & 1 == 1 {
                rng[0] = mid;
            } else {
                rng[1] = mid;
            }
            even = !even;
        }
    }
    ((la[0] + la[1]) / 2.0, (lo[0] + lo[1]) / 2.0)
}

/// Nearest-rank percentile of response times, rounded to one decimal; None for an empty list.
pub fn percentile(a: &[f64], p: f64) -> Option<f64> {
    if a.is_empty() {
        return None;
    }
    let mut s = a.to_vec();
    s.sort_by(|x, y| x.partial_cmp(y).unwrap());
    let i = ((p * s.len() as f64).floor() as usize).min(s.len() - 1);
    Some(js_round(s[i] * 10.0) / 10.0)
}
