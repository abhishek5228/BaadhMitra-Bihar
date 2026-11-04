// Offline demo backend. It runs the SAME shared code as the Lambdas (redaction, extraction,
// clustering, scoring, gauge states), so what you see in the demo is how the real pipeline behaves.
import type { Alert, AuditRow, Fb, Gauge, Inc, Team } from '../../shared/types'
import { STATIONS, simlvl } from '../../shared/stations'
import { redact } from '../../shared/redact'
import { rulex } from '../../shared/extract'
import { merge, score } from '../../shared/score'
import { metrics as calc } from '../../shared/sla'
import { ghash } from '../../shared/geo'
import { atext, grank, gstate } from '../../shared/alert'
import type { Api, Pin, St } from './api'

const DEMO_TEAMS: [string, number, number][] = [
  ['NDRF Team A', 25.65, 85.2],
  ['SDRF Boat 2', 26.1, 86.6],
  ['Local fishermen boats', 25.45, 87.2],
  ['Army flood column', 25.8, 85.9],
]

// Invented example messages (no real people). Several senders per area show clustering.
export const SEED: [string, string][] = [
  ['सुपौल में पानी कमर तक है, २० लोग फंसे हैं, बच्चे और बुजुर्ग भी, नाव चाहिए और खाना', 'a1'],
  ['Supaul ke gaon me paani kamar tak, 15 log, naav bhej dijiye', 'a2'],
  ['Supaul me bahut paani hai, ghar doob raha hai, bachche chhat par', 'a3'],
  ['Kursela me paani chhat par aa gaya, 6 log hain, ek garbhwati mahila, dawai chahiye', 'b1'],
  ['कुरसेला में हालत बहुत खराब है, गर्भवती महिला को अस्पताल चाहिए, नाव भेजें', 'b2'],
  ['Naugachia: water at chest level, 12 people on the roof, need boat and drinking water', 'c1'],
  ['नौगछिया में पानी छाती तक, खाना खत्म हो गया, 30 लोग', 'c2'],
  ['Murliganj me ghutne tak paani, 8 log, khana chahiye', 'd1'],
  ['मधेपुरा में पानी घुटनों तक आ गया है, बुजुर्ग हैं घर में', 'e1'],
  ['Saharsa me kamar tak paani, 10 log, ek bimar admi, doctor chahiye', 'f1'],
  ['Khagaria: 25 log phanse hain, paani gardan tak, boat urgently', 'g1'],
  ['खगड़िया में बाढ़ का पानी घर में घुस गया, बच्चे भूखे हैं, राशन चाहिए', 'g2'],
  ['Bhagalpur me nadi ka paani sadak par aa gaya', 'h1'],
  ['Muzaffarpur me ghutne tak paani, 5 log, tirpal chahiye', 'i1'],
  ['help', 'j1'],
]

export const SURGE: string[] = [
  'Manihari me paani chhat par, 18 log, naav chahiye, bachche aur bujurg',
  'Katihar ke paas gaon doob gaya, 40 log phanse hain, boat bhejiye',
  'Supaul me paani aur badh gaya, 30 log, khana aur dawai chahiye',
  'Birpur me kamar tak paani, 14 log, naav chahiye',
  'Nirmali: water at neck level, 9 people, elderly, boat urgently',
  'Kursela me ek aur parivar phansa hai, 7 log, garbhwati mahila',
  'Naugachia me paani badh raha hai, khana aur peene ka pani chahiye',
  'Araria me ghutne tak paani, 10 log',
  'Purnia me paani kamar tak, 20 log, bachche, naav chahiye',
  'Madhepura me paani chhati tak, 16 log, bimar bujurg, dawai chahiye',
]

export function demoApi(): Api {
  const incs = new Map<string, Inc>()
  const alerts: Alert[] = []
  const gs = new Map<string, Gauge>()
  let reports = 0
  let rule = 0
  let unpl = 0
  let lift = 0 // metres added to every river by the surge button
  let n = 0

  const ingest = (text: string, who: string, pin?: Pin): void => {
    reports++
    const clean = redact(text)
    const rep = rulex(clean)
    rule++
    if (pin) {
      rep.lat = pin.lat
      rep.lon = pin.lon
    }
    if (rep.lat === null) {
      unpl++
      return
    }
    const id = ghash(rep.lat, rep.lon as number, 5)
    incs.set(id, merge(incs.get(id) ?? null, rep, clean, who))
  }

  SEED.forEach(([t, w]) => ingest(t, w))
  // Back-date the two highest-priority incidents so the overdue badges are visible in the demo.
  ;[...incs.values()].sort((a, b) => b.score - a.score).slice(0, 2).forEach((i, k) => incs.set(i.id, { ...i, opn: Date.now() - (k ? 22 : 41) * 60_000 }))

  const readGauges = (): Gauge[] => {
    const now = Date.now()
    return STATIONS.map((s) => {
      const lvl = Math.round((simlvl(s, now) + lift) * 100) / 100
      const prev = gs.get(s.id)
      const g: Gauge = {
        id: s.id,
        name: s.name,
        river: s.river,
        lat: s.lat,
        lon: s.lon,
        lvl,
        danger: s.danger,
        state: gstate(lvl, s.danger),
        trend: Math.round((lvl - (simlvl(s, now - 3600_000) + lift)) * 100) / 100,
        ts: now,
        sim: true,
      }
      if (prev && grank[g.state] > grank[prev.state]) {
        const t = atext(g)
        alerts.unshift({ id: 'd' + ++n, ts: now, gid: g.id, name: g.name, state: g.state, en: t.en, hi: t.hi })
        alerts.length = Math.min(alerts.length, 15)
      }
      gs.set(s.id, g)
      return g
    })
  }
  readGauges()

  const trail: AuditRow[] = []
  const fbs: Fb[] = []
  const snapshot = (): Inc[] => {
    for (const [k, v] of incs) incs.set(k, { ...v, score: score(v) })
    return [...incs.values()].filter((i) => i.status !== 'resolved' && i.status !== 'dismissed').sort((a, b) => b.score - a.score)
  }

  return {
    mode: 'demo',
    who: '',
    roles: ['district_officer'],
    incidents: async () => snapshot(),
    gauges: async () => readGauges(),
    alerts: async () => [...alerts],
    stats: async (): Promise<St> => ({
      reports,
      incidents: incs.size,
      rule,
      review: [...incs.values()].filter((i) => i.review).length,
      dedup: reports ? Math.max(0, Math.round((1 - incs.size / reports) * 100) / 100) : 0,
      unpl,
    }),
    report: async (text, pin) => ingest(text, 'me', pin),
    voice: async () => {
      throw new Error('Voice notes need the live AWS backend (Transcribe). Type your message in demo mode.')
    },
    assign: async (id, team) => {
      const i = incs.get(id)
      if (i) incs.set(id, { ...i, status: 'assigned', team, asg: Date.now(), esc: 0, ver: i.ver + 1 })
      trail.unshift({ id: String(Date.now()), ts: Date.now(), actor: 'demo', action: 'assigned', target: id, team })
    },
    resolve: async (id) => {
      const i = incs.get(id)
      if (i) incs.set(id, { ...i, status: 'resolved', res: Date.now(), by: 'control', ver: i.ver + 1 })
      trail.unshift({ id: String(Date.now()), ts: Date.now(), actor: 'demo', action: 'resolved', target: id })
    },
    dismiss: async (id) => {
      const i = incs.get(id)
      if (i) incs.set(id, { ...i, status: 'dismissed', ver: i.ver + 1 })
      trail.unshift({ id: String(Date.now()), ts: Date.now(), actor: 'demo', action: 'dismissed', target: id })
    },
    audit: async () => [...trail],
    teams: async (): Promise<Team[]> => {
      // Invented crews that drift a little so the map shows live team markers in the demo.
      const t = Date.now() / 1000
      const busy = new Set([...incs.values()].filter((i) => i.status === 'assigned').map((i) => i.team))
      return DEMO_TEAMS.map(([id, lat, lon], k) => ({ id, lat: lat + Math.sin(t / 40 + k) * 0.03, lon: lon + Math.cos(t / 40 + k) * 0.03, ts: Date.now(), busy: busy.has(id) }))
    },
    feedback: async (id, ok, wrong) => {
      const i = incs.get(id)
      if (!i) return
      fbs.push({ id: String(Date.now()), ts: Date.now(), actor: 'demo', inc: id, ok, wrong: ok ? [] : wrong, place: i.place, ppl: i.ppl, needs: i.needs, sev: i.sev, texts: i.snips.map((x) => x.t) })
    },
    metrics: async () => calc([...incs.values()], fbs, Date.now()),
    fbExport: async () => [...fbs],
    surge: () => {
      lift = 2.2
      SURGE.forEach((t, k) => setTimeout(() => ingest(t, 's' + k), 800 + k * 1400))
      for (let k = 0; k < 6; k++) setTimeout(() => ingest(SURGE[k % SURGE.length], 'x' + k), 3000 + k * 1700) // repeat reporters from new people
      setTimeout(() => (lift = 0.6), 45_000)
    },
  }
}
