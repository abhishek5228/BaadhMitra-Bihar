import { PutObjectCommand } from '@aws-sdk/client-s3'
import { PublishCommand } from '@aws-sdk/client-sns'
import { PollyClient, SynthesizeSpeechCommand } from '@aws-sdk/client-polly'
import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb'
import { TBL, ddb, emf, env, listGauges, pad, rid, s3, sns } from './lib/aws'
import { isStale, normalize, type Rd } from './lib/feed'
import { STATIONS, simlvl } from '../shared/stations'
import { atext, grank, gstate } from '../shared/alert'
import type { Alert, Gauge } from '../shared/types'

const polly = new PollyClient({})

/**
 * Readings come from a pluggable JSON feed (GAUGE_FEED_URL), see lib/feed.ts for the shape.
 * With NO feed configured the simulator runs and every reading is flagged `sim`.
 * With a feed configured, the simulator is never used: if the feed is down the last real readings
 * are kept but marked stale, because a made-up number must never replace an official one.
 */
async function readings(now: number): Promise<{ rows: Rd[]; down: boolean }> {
  const url = env('FEED')
  if (!url) return { rows: STATIONS.map((s) => ({ id: s.id, name: s.name, river: s.river, lat: s.lat, lon: s.lon, danger: s.danger, lvl: simlvl(s, now), ts: now, sim: true })), down: false }
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) })
    if (r.ok) {
      const { rows, dropped } = normalize(await r.json())
      if (dropped) emf('FeedDropped', dropped)
      if (rows.length) return { rows, down: false }
    }
    emf('FeedBad', 1)
  } catch {
    emf('FeedDown', 1)
  }
  return { rows: [], down: true }
}

async function raise(g: Gauge, now: number): Promise<void> {
  const id = rid()
  const t = atext(g)
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

const g0ts = (r: Rd, now: number): number => r.ts ?? now

/** Scheduled by EventBridge. Alerts only on escalation, so a river sitting above danger does not spam. */
export const handler = async (): Promise<void> => {
  const now = Date.now()
  const { rows, down } = await readings(now)
  if (down) {
    // Feed unavailable: keep the last official readings, flag them stale so the UI greys them out.
    for (const g of await listGauges()) {
      const st = g.sim ? g.stale : true
      if (st && !g.stale) await ddb.send(new PutCommand({ TableName: TBL(), Item: { pk: 'G#' + g.id, sk: 'L', g1p: 'GAUGE', g1s: g.id, g: { ...g, stale: true } } }))
    }
    emf('GaugePolls', 1)
    return
  }
  for (const r of rows) {
    const key = { pk: 'G#' + r.id, sk: 'L' }
    const prev = (await ddb.send(new GetCommand({ TableName: TBL(), Key: key }))).Item?.g as Gauge | undefined
    const hrs = prev ? Math.max(0.05, (g0ts(r, now) - prev.ts) / 3600_000) : 0
    const g: Gauge = {
      id: r.id,
      name: r.name,
      river: r.river,
      lat: r.lat,
      lon: r.lon,
      lvl: r.lvl,
      danger: r.danger,
      state: gstate(r.lvl, r.danger),
      trend: prev ? Math.round(((r.lvl - prev.lvl) / hrs) * 100) / 100 : 0,
      ts: r.ts ?? now,
      sim: r.sim,
      stale: isStale(r.ts, now),
    }
    await ddb.send(new PutCommand({ TableName: TBL(), Item: { ...key, g1p: 'GAUGE', g1s: r.id, g } }))
    await ddb.send(new PutCommand({ TableName: TBL(), Item: { pk: 'G#' + r.id, sk: 'H#' + pad(now / 1000, 12), lvl: r.lvl, ttl: Math.floor(now / 1000) + 30 * 86400 } }))
    // A real warning needs a rising river; a simulated one just needs to cross the line (it is a demo).
    const rising = !g.stale && (g.trend > 0 || g.sim)
    if (grank[g.state] > grank[prev?.state ?? 'normal'] && rising) await raise(g, now)
  }
  emf('GaugePolls', 1)
}
