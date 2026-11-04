// Shared types: used by Lambdas, the CDK stack, the eval script and the 3D web app.

export type Need = 'boat' | 'food' | 'water' | 'medical' | 'shelter'
export const NEEDS: Need[] = ['boat', 'food', 'water', 'medical', 'shelter']

/** Structured facts pulled out of one raw distress message. */
export interface Rep {
  place: string | null // village / town / district as written
  lat: number | null
  lon: number | null
  depth: number | null // water depth in cm, if stated
  ppl: number | null // people at risk, if stated
  needs: Need[]
  vul: boolean // children / elderly / pregnant / disabled / ill
  sev: 1 | 2 | 3 | 4 | 5 // severity
  conf: number // 0..1 confidence of the extraction
  src: 'llm' | 'rule' // which extractor produced it
}

export type IncStatus = 'open' | 'assigned' | 'resolved' | 'dismissed' // dismissed = judged false or duplicate by a person

export interface Snip {
  ts: number
  t: string // redacted text
  conf: number
  src: 'llm' | 'rule'
}

/** One rescue incident = a cluster of reports from the same ~5 km cell. */
export interface Inc {
  id: string // geohash5
  place: string
  lat: number
  lon: number
  n: number // unique reporters (spam resistant)
  raw: number // raw reports received
  sev: number // max severity seen
  ppl: number // max people at risk seen
  vul: boolean
  needs: Need[]
  conf: number // running mean confidence
  review: boolean // a human should look (low confidence)
  first: number
  last: number
  status: IncStatus
  team?: string
  score: number // 0..100 priority score
  snips: Snip[]
  who: string[] // hashed reporter ids (capped)
  ver: number // optimistic lock
}

export type GState = 'normal' | 'warn' | 'danger'

export interface Gauge {
  id: string
  name: string
  river: string
  lat: number
  lon: number
  lvl: number // metres
  danger: number // metres
  state: GState
  trend: number // metres per hour
  ts: number
  sim?: boolean // simulated reading
  stale?: boolean // the feed is down or the reading is old: show it greyed out, never alert on it
}

export interface Alert {
  id: string
  ts: number
  gid: string
  name: string
  state: GState
  en: string
  hi: string
  audio?: string // presigned URL (Polly Hindi voice)
}

export interface Stats {
  reports: number
  incidents: number
  rule: number // answered by the offline rule extractor
  review: number
  dedup: number // 1 - incidents/reports
}

/** One line of the audit trail: who did what to which incident, and when. */
export interface AuditRow {
  id: string
  ts: number
  actor: string
  action: string
  target: string
  team?: string
}

export type Role = 'district_officer' | 'control_room' | 'viewer'
