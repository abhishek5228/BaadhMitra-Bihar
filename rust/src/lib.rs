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
