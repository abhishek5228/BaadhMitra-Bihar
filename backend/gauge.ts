import { PutObjectCommand } from '@aws-sdk/client-s3'
import { PublishCommand } from '@aws-sdk/client-sns'
import { PollyClient, SynthesizeSpeechCommand } from '@aws-sdk/client-polly'
import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb'
import { TBL, ddb, emf, env, pad, rid, s3, sns } from './lib/aws'
import { STATIONS, simlvl } from '../shared/stations'
import type { Alert, Gauge, GState } from '../shared/types'

const polly = new PollyClient({})

interface Rd {
  id: string
  name: string
  river: string
  lat: number
  lon: number
  lvl: number
  danger: number
  sim: boolean
}

/**
 * Readings come from a pluggable JSON feed (GAUGE_FEED_URL) shaped
 * [{id,name,river,lat,lon,lvl,danger}]. With no feed configured, or if the feed is down,
 * the simulator is used and every reading is flagged `sim` so it can never be mistaken for real data.
 */
async function readings(now: number): Promise<Rd[]> {
  const url = env('FEED')
  if (url) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(8000) })
      if (r.ok) {
        const js = (await r.json()) as Omit<Rd, 'sim'>[]
        const good = js.filter((x) => x && typeof x.id === 'string' && Number.isFinite(x.lvl) && Number.isFinite(x.danger))
        if (good.length) return good.map((x) => ({ ...x, sim: false }))
      }
      emf('FeedBad', 1)
    } catch {
      emf('FeedDown', 1)
    }
  }
  return STATIONS.map((s) => ({ id: s.id, name: s.name, river: s.river, lat: s.lat, lon: s.lon, danger: s.danger, lvl: simlvl(s, now), sim: true }))
}

const state = (lvl: number, danger: number): GState => (lvl >= danger ? 'danger' : lvl >= danger - 1 ? 'warn' : 'normal')
const rank: Record<GState, number> = { normal: 0, warn: 1, danger: 2 }

function texts(g: Gauge): { en: string; hi: string } {
  const gap = Math.abs(g.danger - g.lvl).toFixed(2)
  if (g.state === 'danger')
    return {
      en: `Flood danger: ${g.river} at ${g.name} is ${g.lvl.toFixed(2)} m, ${gap} m above the danger level. Move to higher ground now. Do not cross flowing water.`,
      hi: `बाढ़ का खतरा: ${g.name} पर ${g.river} का जलस्तर ${g.lvl.toFixed(2)} मीटर है, खतरे के निशान से ${gap} मीटर ऊपर। अभी ऊँची जगह पर जाएँ। बहते पानी को पार न करें।`,
    }
  return {
    en: `Flood warning: ${g.river} at ${g.name} is ${g.lvl.toFixed(2)} m, ${gap} m below the danger level and rising. Prepare to move.`,
    hi: `बाढ़ की चेतावनी: ${g.name} पर ${g.river} का जलस्तर ${g.lvl.toFixed(2)} मीटर है, खतरे के निशान से ${gap} मीटर नीचे है। जाने की तैयारी रखें।`,
  }
}

async function raise(g: Gauge, now: number): Promise<void> {
  const id = rid()
  const t = texts(g)
  let akey: string | undefined
  try {
    // Hindi voice for people who cannot read, or are reading by torchlight.
    const v = await polly.send(new SynthesizeSpeechCommand({ Text: t.hi, VoiceId: 'Kajal', Engine: 'neural', LanguageCode: 'hi-IN', OutputFormat: 'mp3' }))
    const buf = Buffer.from((await v.AudioStream?.transformToByteArray()) ?? [])
    if (buf.length) {
      akey = `alerts/${id}.mp3`
      await s3.send(new PutObjectCommand({ Bucket: env('BKT'), Key: akey, Body: buf, ContentType: 'audio/mpeg' }))
    }
  } catch (err) {
    console.warn('polly failed', (err as Error).name) // the text alert still goes out
    emf('PollyError', 1)
  }
  const a: Alert = { id, ts: now, gid: g.id, name: g.name, state: g.state, en: t.en, hi: t.hi }
  await ddb.send(new PutCommand({ TableName: TBL(), Item: { pk: 'A#' + id, sk: 'M', g1p: 'ALERT', g1s: pad(now / 1000, 12), a, akey, ttl: Math.floor(now / 1000) + 30 * 86400 } }))
  if (env('TOPIC')) {
    await sns.send(new PublishCommand({ TopicArn: env('TOPIC'), Subject: `BaadhMitra ${g.state}: ${g.name}`.slice(0, 99), Message: `${t.hi}\n\n${t.en}` }))
  }
  emf('AlertsRaised', 1)
}

/** Scheduled by EventBridge. Alerts only on escalation, so a river sitting above danger does not spam. */
export const handler = async (): Promise<void> => {
  const now = Date.now()
  for (const r of await readings(now)) {
    const key = { pk: 'G#' + r.id, sk: 'L' }
    const prev = (await ddb.send(new GetCommand({ TableName: TBL(), Key: key }))).Item?.g as Gauge | undefined
    const hrs = prev ? Math.max(0.05, (now - prev.ts) / 3600_000) : 0
    const g: Gauge = {
      id: r.id,
      name: r.name,
      river: r.river,
      lat: r.lat,
      lon: r.lon,
      lvl: r.lvl,
      danger: r.danger,
      state: state(r.lvl, r.danger),
      trend: prev ? Math.round(((r.lvl - prev.lvl) / hrs) * 100) / 100 : 0,
      ts: now,
      sim: r.sim,
    }
    await ddb.send(new PutCommand({ TableName: TBL(), Item: { ...key, g1p: 'GAUGE', g1s: r.id, g } }))
    await ddb.send(new PutCommand({ TableName: TBL(), Item: { pk: 'G#' + r.id, sk: 'H#' + pad(now / 1000, 12), lvl: r.lvl, ttl: Math.floor(now / 1000) + 30 * 86400 } }))
    // A real warning needs a rising river; a simulated one just needs to cross the line (it is a demo).
    const rising = g.trend > 0 || g.sim
    if (rank[g.state] > rank[prev?.state ?? 'normal'] && rising) await raise(g, now)
  }
  emf('GaugePolls', 1)
}
