import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda'
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager'
import { PutObjectCommand } from '@aws-sdk/client-s3'
import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb'
import { TBL, bad, ddb, emf, env, ok, s3, sha } from './lib/aws'
import { accept, allow, voiceMeta, type Pin } from './lib/intake'
import { extOf, parseWa, sigok, type WaMsg } from './lib/wa'
import { inBihar } from '../shared/geo'

// WhatsApp Business Cloud API webhook (Meta). Needs a verified Meta business account:
// see docs/WHATSAPP.md. Secret JSON in Secrets Manager: {verify_token, app_secret, access_token, phone_id}.
const sm = new SecretsManagerClient({})
const G = 'https://graph.facebook.com/v21.0'

interface Sec {
  verify_token: string
  app_secret: string
  access_token: string
  phone_id: string
}
let cache: { at: number; v: Sec } | null = null
async function secret(): Promise<Sec> {
  if (cache && Date.now() - cache.at < 300_000) return cache.v
  const r = await sm.send(new GetSecretValueCommand({ SecretId: env('WA_SECRET') }))
  const v = JSON.parse(r.SecretString ?? '{}') as Partial<Sec>
  cache = { at: Date.now(), v: { verify_token: v.verify_token ?? '', app_secret: v.app_secret ?? '', access_token: v.access_token ?? '', phone_id: v.phone_id ?? '' } }
  return cache.v
}

const hdr = (e: APIGatewayProxyEvent, k: string): string | undefined => {
  const h = e.headers ?? {}
  const key = Object.keys(h).find((x) => x.toLowerCase() === k)
  return key ? (h[key] ?? undefined) : undefined
}

// Replies never promise help: we are a reporting channel, not a rescue service.
const R_OK = 'आपकी सूचना दर्ज हो गई है और कंट्रोल रूम तक पहुँचाई जा रही है। आपातकाल में तुरंत 112 पर कॉल करें। अपनी जगह भेजने के लिए: 📎 → Location।'
const R_LOC = 'आपकी जगह मिल गई। अब अपनी स्थिति लिखें या आवाज़ भेजें।'
const R_RATE = 'आपने बहुत संदेश भेजे हैं। कृपया थोड़ी देर बाद भेजें। आपातकाल में 112 पर कॉल करें।'
const R_OTHER = 'कृपया संदेश लिखकर या आवाज़ (voice note) भेजकर बताएँ। आपातकाल में 112 पर कॉल करें।'

async function reply(s: Sec, to: string, body: string): Promise<void> {
  try {
    await fetch(`${G}/${s.phone_id}/messages`, {
      method: 'POST',
      headers: { authorization: `Bearer ${s.access_token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body } }),
      signal: AbortSignal.timeout(6000),
    })
  } catch {
    emf('WaReplyFailed', 1) // a failed courtesy reply must never fail the report itself
  }
}

async function pinOf(who: string): Promise<Pin | null> {
  const r = await ddb.send(new GetCommand({ TableName: TBL(), Key: { pk: 'P#' + who, sk: 'P' } }))
  const p = r.Item as { lat?: number; lon?: number } | undefined
  return p?.lat !== undefined && p.lon !== undefined ? { lat: p.lat, lon: p.lon } : null
}

async function audio(s: Sec, m: WaMsg, who: string, p: Pin | null): Promise<'ok' | 'rate' | 'bad'> {
  if (!(await allow(who))) return 'rate'
  const ext = extOf(m.mime ?? '')
  if (!ext || !m.media) return 'bad'
  const auth = { authorization: `Bearer ${s.access_token}` }
  const meta = (await (await fetch(`${G}/${encodeURIComponent(m.media)}`, { headers: auth, signal: AbortSignal.timeout(8000) })).json()) as { url?: string }
  if (!meta.url || !meta.url.startsWith('https://')) return 'bad'
  const res = await fetch(meta.url, { headers: auth, signal: AbortSignal.timeout(15000) })
  const buf = Buffer.from(await res.arrayBuffer())
  if (!res.ok || buf.length === 0 || buf.length > 5_000_000) return 'bad'
  const id = await voiceMeta(who, p) // placeholder first: the S3 upload triggers Transcribe
  await s3.send(new PutObjectCommand({ Bucket: env('BKT'), Key: `audio/${id}.${ext}`, Body: buf, ContentType: m.mime || 'audio/ogg' }))
  return 'ok'
}

async function one(s: Sec, m: WaMsg): Promise<void> {
  const who = sha(env('SALT', 'bm') + 'wa:' + m.from) // the phone number itself is never stored
  if (m.type === 'location' && m.lat !== undefined && m.lon !== undefined) {
    if (inBihar(m.lat, m.lon))
      await ddb.send(new PutCommand({ TableName: TBL(), Item: { pk: 'P#' + who, sk: 'P', lat: m.lat, lon: m.lon, ttl: Math.floor(Date.now() / 1000) + 2 * 3600 } }))
    await reply(s, m.from, R_LOC)
    return
  }
  const p = await pinOf(who)
  if (m.type === 'text') {
    const r = await accept(m.text ?? '', who, p)
    await reply(s, m.from, r.ok || r.why === 'dup' ? R_OK : r.why === 'rate' ? R_RATE : R_OTHER)
  } else if (m.type === 'audio') {
    const r = await audio(s, m, who, p)
    await reply(s, m.from, r === 'ok' ? R_OK : r === 'rate' ? R_RATE : R_OTHER)
  } else {
    await reply(s, m.from, R_OTHER)
  }
}

export const handler = async (e: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const s = await secret()

  // Meta's one-time ownership check when you register the webhook URL.
  if (e.httpMethod === 'GET') {
    const q = e.queryStringParameters ?? {}
    if (s.verify_token && q['hub.mode'] === 'subscribe' && q['hub.verify_token'] === s.verify_token) return { statusCode: 200, headers: { 'content-type': 'text/plain' }, body: q['hub.challenge'] ?? '' }
    return bad('forbidden', 403)
  }

  const raw = e.isBase64Encoded ? Buffer.from(e.body ?? '', 'base64').toString('utf8') : (e.body ?? '')
  if (!s.app_secret) return bad('whatsapp not configured', 503) // refuse everything until a signing secret exists
  if (!sigok(raw, hdr(e, 'x-hub-signature-256'), s.app_secret)) {
    emf('WaBadSignature', 1)
    return bad('bad signature', 403)
  }

  let js: unknown
  try {
    js = JSON.parse(raw)
  } catch {
    return bad('bad json')
  }
  for (const m of parseWa(js)) {
    const key = { pk: 'K#wa' + m.id, sk: 'K' }
    if ((await ddb.send(new GetCommand({ TableName: TBL(), Key: key }))).Item) continue // Meta retries: handle each message once
    await one(s, m) // an error here returns 500, so Meta retries instead of the report being lost
    await ddb.send(new PutCommand({ TableName: TBL(), Item: { ...key, ttl: Math.floor(Date.now() / 1000) + 86400 } }))
    emf('WaIn', 1)
  }
  return ok({ ok: true })
}
