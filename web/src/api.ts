import type { Alert, AuditRow, Fb, Gauge, Inc, Metrics, Role, Stats, Team, Wrong } from '../../shared/types'
import { clear, load, token, type Cfg, type Sess } from './auth'
import { demoApi } from './demo'

export type Pin = { lat: number; lon: number }
export type St = Stats & { unpl: number }

export interface Api {
  mode: 'demo' | 'live'
  who: string // signed-in person (empty in demo)
  roles: Role[]
  signOut?: () => void
  incidents(): Promise<Inc[]>
  gauges(): Promise<Gauge[]>
  alerts(): Promise<Alert[]>
  stats(): Promise<St>
  report(text: string, pin?: Pin): Promise<void>
  voice(blob: Blob, ext: string, pin?: Pin): Promise<void>
  assign(id: string, team: string): Promise<void>
  resolve(id: string): Promise<void>
  dismiss(id: string): Promise<void>
  audit(): Promise<AuditRow[]>
  teams(): Promise<Team[]>
  feedback(id: string, ok: boolean, wrong: Wrong[]): Promise<void>
  metrics(): Promise<Metrics>
  fbExport(): Promise<Fb[]>
  surge?: () => void // demo only
}

/** A stable anonymous id so one phone texting ten times still counts once. */
function me(): string {
  try {
    let v = localStorage.getItem('bmid')
    if (!v) {
      v = crypto.randomUUID()
      localStorage.setItem('bmid', v)
    }
    return v
  } catch {
    return 'anon'
  }
}

export class Expired extends Error {}

function live(cfg: Cfg, ss: Sess): Api {
  const root = cfg.api.replace(/\/$/, '')
  const call = async <T>(m: string, p: string, b?: unknown): Promise<T> => {
    const tok = await token(cfg, ss)
    if (!tok) {
      clear()
      throw new Expired('session ended')
    }
    const r = await fetch(root + p, {
      method: m,
      headers: { 'content-type': 'application/json', authorization: tok },
      body: b === undefined ? undefined : JSON.stringify(b),
    })
    if (r.status === 401) {
      clear()
      throw new Expired('session ended')
    }
    if (!r.ok) throw new Error(`${m} ${p} -> ${r.status}`)
    return (await r.json()) as T
  }
  const pinb = (p?: Pin) => (p ? { lat: p.lat, lon: p.lon } : {})
  return {
    mode: 'live',
    who: ss.email,
    roles: ss.roles,
    signOut: () => {
      clear()
      location.reload()
    },
    incidents: async () => (await call<{ items: Inc[] }>('GET', '/incidents')).items,
    gauges: async () => (await call<{ items: Gauge[] }>('GET', '/gauges')).items,
    alerts: async () => (await call<{ items: Alert[] }>('GET', '/alerts')).items,
    stats: () => call<St>('GET', '/stats'),
    report: async (text, pin) => {
      await call('POST', '/reports', { text, sender: me(), ...pinb(pin) })
    },
    voice: async (blob, ext, pin) => {
      const u = await call<{ url: string; type: string }>('POST', '/upload-url', { ext, sender: me(), ...pinb(pin) })
      const r = await fetch(u.url, { method: 'PUT', headers: { 'content-type': u.type }, body: blob })
      if (!r.ok) throw new Error('upload failed ' + r.status)
    },
    assign: async (id, team) => {
      await call('POST', `/incidents/${encodeURIComponent(id)}/assign`, { team })
    },
    resolve: async (id) => {
      await call('POST', `/incidents/${encodeURIComponent(id)}/resolve`, {})
    },
    dismiss: async (id) => {
      await call('POST', `/incidents/${encodeURIComponent(id)}/dismiss`, {})
    },
    audit: async () => (await call<{ items: AuditRow[] }>('GET', '/audit')).items,
    teams: async () => (await call<{ items: Team[] }>('GET', '/teams')).items,
    feedback: async (id, ok, wrong) => {
      await call('POST', `/incidents/${encodeURIComponent(id)}/feedback`, { ok, wrong })
    },
    metrics: () => call<Metrics>('GET', '/metrics'),
    fbExport: async () => (await call<{ items: Fb[] }>('GET', '/feedback')).items,
  }
}

/** What the page found out at start-up: a live API with a session, a login to show, or the offline demo. */
export type Boot = { api: Api; cfg: Cfg | null; needLogin: boolean }

export async function connect(): Promise<Boot> {
  let cfg: Cfg | null = null
  try {
    const r = await fetch('config.json', { cache: 'no-store' })
    if (r.ok) {
      const c = (await r.json()) as Partial<Cfg>
      if (c.api && c.region && c.clientId) cfg = { api: c.api, region: c.region, clientId: c.clientId }
    }
  } catch {
    /* no config: demo mode */
  }
  const ss = cfg ? load() : null
  if (new URLSearchParams(location.search).has('demo')) return { api: demoApi(), cfg, needLogin: false } // explicit offline demo
  if (cfg && ss) return { api: live(cfg, ss), cfg, needLogin: false }
  return { api: demoApi(), cfg, needLogin: cfg !== null }
}

/** The unauthenticated citizen endpoints, used by the public report page. */
export function citizen(base: string): { report(text: string, pin?: Pin): Promise<void> } {
  const root = base.replace(/\/$/, '')
  return {
    report: async (text, pin) => {
      const r = await fetch(root + '/reports', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text, sender: me(), ...(pin ? { lat: pin.lat, lon: pin.lon } : {}) }),
      })
      if (!r.ok && r.status !== 200) throw new Error(String(r.status))
    },
  }
}

/** Authenticated JSON caller for pages that are not the dashboard (the field-team page). */
export function authed(cfg: Cfg, ss: Sess) {
  const root = cfg.api.replace(/\/$/, '')
  return async <T>(m: string, p: string, b?: unknown): Promise<{ status: number; data: T | null }> => {
    const tok = await token(cfg, ss)
    if (!tok) {
      clear()
      throw new Expired('session ended')
    }
    const r = await fetch(root + p, { method: m, headers: { 'content-type': 'application/json', authorization: tok }, body: b === undefined ? undefined : JSON.stringify(b) })
    if (r.status === 401) {
      clear()
      throw new Expired('session ended')
    }
    return { status: r.status, data: r.ok ? ((await r.json()) as T) : null }
  }
}
