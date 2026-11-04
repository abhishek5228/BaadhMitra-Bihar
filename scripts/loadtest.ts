// Load test for the PUBLIC report endpoint.
//   npm run loadtest -- https://<api>/prod 200 20 --yes
//                        base URL            count concurrency
// It creates REAL test incidents in whatever stack you point it at (all near Patna, marked "LOADTEST").
// Use a staging stack, or delete the rows afterwards. The API throttle (reportRps) will answer 429 above
// its limit: that is the control working, and the 429 count is reported separately from real failures.
const [base, nArg, cArg, yes] = process.argv.slice(2)
if (!base || yes !== '--yes') {
  console.error('usage: npm run loadtest -- <apiBaseUrl> <count> <concurrency> --yes')
  process.exit(2)
}
const N = Math.min(5000, Math.max(1, Number(nArg) || 100))
const C = Math.min(100, Math.max(1, Number(cArg) || 10))
const root = base.replace(/\/$/, '')

const lat: number[] = []
const codes = new Map<number, number>()
let net = 0
let next = 0

async function worker(): Promise<void> {
  for (;;) {
    const k = next++
    if (k >= N) return
    const t0 = performance.now()
    try {
      const r = await fetch(root + '/reports', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: `LOADTEST Patna me paani aa gaya ${k}, ${3 + (k % 20)} log, naav chahiye`, sender: 'lt-' + k }),
      })
      await r.arrayBuffer()
      codes.set(r.status, (codes.get(r.status) ?? 0) + 1)
      lat.push(performance.now() - t0)
    } catch {
      net++
    }
  }
}

const t0 = performance.now()
await Promise.all(Array.from({ length: C }, worker))
const secs = (performance.now() - t0) / 1000
lat.sort((a, b) => a - b)
const pct = (p: number) => (lat.length ? Math.round(lat[Math.min(lat.length - 1, Math.floor((p / 100) * lat.length))]) : 0)
console.log(`requests ${N}, concurrency ${C}, ${secs.toFixed(1)}s, ${(N / secs).toFixed(1)} req/s`)
console.log('status codes:', Object.fromEntries([...codes].sort()))
console.log(`network errors: ${net}`)
console.log(`latency ms  p50 ${pct(50)}  p95 ${pct(95)}  p99 ${pct(99)}  max ${Math.round(lat[lat.length - 1] ?? 0)}`)
console.log('Then check the CloudWatch dashboard: queue age should drain, DLQ should stay at 0.')
