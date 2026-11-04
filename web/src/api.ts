import type { Alert, Gauge, Inc, Stats } from '../../shared/types'
import { demoApi } from './demo'

export type Pin = { lat: number; lon: number }
export type St = Stats & { unpl: number }

export interface Api {
  mode: 'demo' | 'live'
  incidents(): Promise<Inc[]>
  gauges(): Promise<Gauge[]>
  alerts(): Promise<Alert[]>
  stats(): Promise<St>
  report(text: string, pin?: Pin): Promise<void>
  voice(blob: Blob, ext: string, pin?: Pin): Promise<void>
  assign(id: string, team: string): Promise<void>
  resolve(id: string): Promise<void>
  surge?: () => void // demo only
}

const KEY = 'bmkey'
export const getKey = (): string => {
  try {
    return sessionStorage.getItem(KEY) ?? ''
  } catch {
    return ''
  }
}
export const setKey = (k: string): void => {
  try {
    sessionStorage.setItem(KEY, k)
  } catch {
    /* private mode: key lives for this page load only */
  }
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

function live(base: string, key: string): Api {
  const root = base.replace(/\/$/, '')
  const call = async <T>(m: string, p: string, b?: unknown): Promise<T> => {
    const r = await fetch(root + p, {
      method: m,
      headers: { 'content-type': 'application/json', 'x-api-key': key },
      body: b === undefined ? undefined : JSON.stringify(b),
    })
    if (!r.ok) throw new Error(`${m} ${p} -> ${r.status}`)
    return (await r.json()) as T
  }
  const pinb = (p?: Pin) => (p ? { lat: p.lat, lon: p.lon } : {})
  return {
    mode: 'live',
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
  }
}

/** Live if config.json (written by the CDK deploy) has an API URL and a key is set; otherwise the offline demo. */
export async function connect(): Promise<{ api: Api; url: string }> {
  let url = ''
  try {
    const r = await fetch('config.json', { cache: 'no-store' })
    if (r.ok) url = ((await r.json()) as { api?: string }).api ?? ''
  } catch {
    /* no config: demo mode */
  }
  const k = getKey()
  return { api: url && k ? live(url, k) : demoApi(), url }
}
