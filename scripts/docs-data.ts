// Computes the numbers behind the README graphs from the real shared code. Nothing here is typed in by hand.
//   npm run docs:data && python3 scripts/docs-graphs.py
import { writeFileSync } from 'node:fs'
import { rulex } from '../shared/extract'
import { redact } from '../shared/redact'
import { merge, score } from '../shared/score'
import { ghash } from '../shared/geo'
import { sla } from '../shared/sla'
import { STATIONS, simlvl } from '../shared/stations'
import { SEED, SURGE } from '../web/src/demo'
import type { Inc } from '../shared/types'

// 1. what the extractor reads from example messages (invented messages, rule extractor, no AI model)
const EX = [
  'सुपौल में पानी कमर तक है, 20 लोग फंसे हैं, बच्चे और बुजुर्ग भी, नाव चाहिए और खाना',
  'Kursela me paani chhat par aa gaya, 6 log hain, ek garbhwati mahila, dawai chahiye',
  'Naugachia: water at chest level, 12 people on the roof, need boat and drinking water',
  'खगड़िया में बाढ़ का पानी घर में घुस गया, बच्चे भूखे हैं, राशन चाहिए',
  'मचान पर चढ़ल बानी, गरभवती मेहरारू बा, अन्न नइखे, पानी में डूबल घर',
  'paani aa gaya ghar me, call 98765 43210',
]
const examples = EX.map((t) => {
  const r = rulex(redact(t))
  return { text: redact(t), place: r.place, ppl: r.ppl, depth: r.depth, needs: r.needs, vul: r.vul, sev: r.sev, conf: r.conf }
})

// 2. priority score as each ingredient grows (all other inputs held fixed)
const NOW = 1_000_000_000
const base = { sev: 3, n: 1, ppl: 10, vul: false, needs: [] as Inc['needs'], last: NOW, status: 'open' as const }
const S = (o: Partial<typeof base>) => score({ ...base, ...o }, NOW)
const curves = {
  reporters: Array.from({ length: 21 }, (_, n) => ({ x: n + 1, y: S({ n: n + 1 }) })),
  people: [0, 2, 5, 10, 20, 40, 80, 150, 300].map((p) => ({ x: p, y: S({ ppl: p }) })),
  severity: [1, 2, 3, 4, 5].map((v) => ({ x: v, y: S({ sev: v }) })),
  flags: [
    { k: 'baseline', y: S({}) },
    { k: '+ vulnerable', y: S({ vul: true }) },
    { k: '+ medical', y: S({ needs: ['medical'] }) },
    { k: '+ boat', y: S({ needs: ['boat'] }) },
    { k: 'all three', y: S({ vul: true, needs: ['medical', 'boat'] }) },
    { k: 'assigned', y: S({ status: 'assigned' }) },
  ],
  age: [0, 15, 30, 60, 120, 240, 480].map((m) => ({ x: m, y: score({ ...base, last: NOW - m * 60_000, n: 3, ppl: 20, sev: 4 }, NOW) })),
}

// 3. reports vs incidents while the demo messages arrive (spam and repeats counted as raw reports)
const inc = new Map<string, Inc>()
const dedupe: { reports: number; incidents: number }[] = []
let reports = 0
const feed = [...SEED.map(([t, w]) => [t, w] as const), ...SURGE.map((t, k) => [t, 's' + k] as const)]
for (const [t, w] of feed) {
  reports++
  const r = rulex(redact(t))
  if (r.lat !== null) {
    const id = ghash(r.lat, r.lon as number, 5)
    inc.set(id, merge(inc.get(id) ?? null, r, t, w, NOW + reports * 1000))
  }
  dedupe.push({ reports, incidents: inc.size })
}

// 4. the overdue clock
const clock = Array.from({ length: 145 }, (_, m) => {
  const mk = (status: Inc['status'], score: number) => sla({ status, score, first: 0, last: 0, asg: 0 }, m * 60_000).lvl
  return { m, urgent: mk('open', 80), normal: mk('open', 40), silent: mk('assigned', 80) }
})

// 5. simulated river gauges over 48 h (the demo simulator, labelled as simulated in the app)
const T0 = Date.UTC(2026, 7, 1, 0, 0, 0)
const gauges = STATIONS.slice(0, 5).map((s) => ({ name: s.name, danger: s.danger, pts: Array.from({ length: 97 }, (_, k) => ({ h: k / 2, lvl: Math.round(simlvl(s, T0 + k * 1800_000) * 100) / 100 })) }))

writeFileSync(new URL('../docs/assets/data.json', import.meta.url), JSON.stringify({ examples, curves, dedupe, clock, gauges }, null, 1))
console.log('wrote docs/assets/data.json', { examples: examples.length, dedupe: dedupe.length })
