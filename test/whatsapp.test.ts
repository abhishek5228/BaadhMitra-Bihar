import { createHmac } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The real WhatsApp webhook handler against an in-memory table, with Meta's servers and AWS replaced.
const db = new Map<string, Record<string, unknown>>()
const queued: Array<Record<string, any>> = []
const puts: string[] = []
const replies: string[] = []
const sec = { json: '' }

vi.hoisted(() => {
  process.env.AWS_REGION = 'ap-south-1'
  process.env.TBL = 'tbl'
  process.env.QURL = 'q'
  process.env.BKT = 'bkt'
  process.env.WA_SECRET = 'arn:secret'
})

const fake = {
  send: async (cmd: { constructor: { name: string }; input: Record<string, any> }) => {
    const n = cmd.constructor.name
    const i = cmd.input
    const key = (k: { pk: string; sk: string }) => k.pk + '|' + k.sk
    if (n === 'PutCommand') {
      const k = key(i.Item)
      if (i.ConditionExpression === 'attribute_not_exists(pk)' && db.has(k)) throw Object.assign(new Error('cond'), { name: 'ConditionalCheckFailedException' })
      db.set(k, structuredClone(i.Item))
      return {}
    }
    if (n === 'GetCommand') return { Item: db.get(key(i.Key)) }
    if (n === 'UpdateCommand') {
      const k = key(i.Key)
      const row = db.get(k) ?? { ...i.Key }
      const ref = /^ADD\s+(\S+)/.exec(i.UpdateExpression)![1]
      const f = (i.ExpressionAttributeNames?.[ref] as string | undefined) ?? ref
      row[f] = Number(row[f] ?? 0) + (Object.values(i.ExpressionAttributeValues)[0] as number)
      db.set(k, row)
      return { Attributes: { [f]: row[f] } }
    }
    if (n === 'SendMessageCommand') {
      queued.push(JSON.parse(i.MessageBody))
      return {}
    }
    if (n === 'PutObjectCommand') {
      puts.push(i.Key)
      return {}
    }
    if (n === 'GetSecretValueCommand') return { SecretString: sec.json }
    throw new Error('unhandled ' + n)
  },
}
vi.mock('@aws-sdk/lib-dynamodb', async () => ({ ...(await vi.importActual<object>('@aws-sdk/lib-dynamodb')), DynamoDBDocumentClient: { from: () => fake } }))
vi.mock('@aws-sdk/client-sqs', async () => ({ ...(await vi.importActual<object>('@aws-sdk/client-sqs')), SQSClient: class { send = fake.send } }))
vi.mock('@aws-sdk/client-s3', async () => ({ ...(await vi.importActual<object>('@aws-sdk/client-s3')), S3Client: class { send = fake.send } }))
vi.mock('@aws-sdk/client-secrets-manager', async () => ({ ...(await vi.importActual<object>('@aws-sdk/client-secrets-manager')), SecretsManagerClient: class { send = fake.send } }))

const SECRET = { verify_token: 'vt', app_secret: 'shh', access_token: 'tok', phone_id: '111' }
const NUMBER = '919800011122'
const T0 = Date.UTC(2026, 7, 1, 6, 0, 0)
let step = 0

const media = { size: 1000, ok: true, url: 'https://cdn.test/x' }
function net() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: { body?: string }) => {
      if (url.includes('/messages')) {
        replies.push(JSON.parse(init?.body ?? '{}').text.body)
        return { ok: true, json: async () => ({}) }
      }
      if (url.startsWith('https://graph.facebook.com') && !url.endsWith('/messages')) return { ok: true, json: async () => ({ url: media.url }) }
      return { ok: media.ok, arrayBuffer: async () => new ArrayBuffer(media.size) }
    }),
  )
}

const payload = (...msgs: unknown[]) => JSON.stringify({ entry: [{ changes: [{ value: { messages: msgs } }] }] })
const text = (id: string, body: string, from = NUMBER) => ({ id, from, type: 'text', text: { body } })
const post = (raw: string, secret = SECRET.app_secret) => ({
  httpMethod: 'POST',
  body: raw,
  headers: { 'X-Hub-Signature-256': 'sha256=' + createHmac('sha256', secret).update(raw).digest('hex') },
}) as any

beforeEach(() => {
  db.clear()
  queued.length = 0
  puts.length = 0
  replies.length = 0
  media.size = 1000
  media.ok = true
  sec.json = JSON.stringify(SECRET)
  vi.useFakeTimers()
  vi.setSystemTime(T0 + ++step * 10 * 60_000) // each test is 10 minutes later, so the 5-minute secret cache never carries over
  net()
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('WhatsApp webhook', async () => {
  const run = (await import('../backend/wa')).handler

  it('answers Meta\'s ownership check only with the right token', async () => {
    const q = (t: string) => ({ httpMethod: 'GET', queryStringParameters: { 'hub.mode': 'subscribe', 'hub.verify_token': t, 'hub.challenge': 'abc123' } }) as any
    expect(await run(q('vt'))).toMatchObject({ statusCode: 200, body: 'abc123' })
    expect((await run(q('wrong'))).statusCode).toBe(403)
  })

  it('refuses a body with a wrong or missing signature, and handles nothing', async () => {
    const raw = payload(text('m1', 'Rampur me paani aa gaya'))
    expect((await run(post(raw, 'not-the-secret'))).statusCode).toBe(403)
    expect((await run({ httpMethod: 'POST', body: raw, headers: {} } as any)).statusCode).toBe(403)
    expect(queued).toHaveLength(0)
    expect(replies).toHaveLength(0)
  })

  it('refuses everything until a signing secret has been configured', async () => {
    sec.json = JSON.stringify({ ...SECRET, app_secret: '' })
    expect((await run(post(payload(text('m1', 'Rampur me paani'))))).statusCode).toBe(503)
    expect(queued).toHaveLength(0)
  })

  it('queues a signed text report once, replies in Hindi with 112, and never stores the phone number', async () => {
    const raw = payload(text('m1', 'Rampur gaon me paani ghar me ghus gaya, 8 log, naav chahiye'))
    expect((await run(post(raw))).statusCode).toBe(200)
    expect(queued).toHaveLength(1)
    expect(queued[0].who).not.toContain(NUMBER)
    expect(replies[0]).toContain('112')
    expect(JSON.stringify([...db.entries()])).not.toContain(NUMBER)
    // Meta retries delivery: the same message id must not be handled a second time
    await run(post(raw))
    expect(queued).toHaveLength(1)
    expect(replies).toHaveLength(1)
  })

  it('keeps a location pin from Bihar and uses it for the next text, but ignores a pin from elsewhere', async () => {
    await run(post(payload({ id: 'l1', from: NUMBER, type: 'location', location: { latitude: 25.6, longitude: 85.1 } })))
    expect(replies[0]).toContain('जगह मिल गई')
    await run(post(payload(text('m2', 'ghar me paani bhar gaya hai, madad chahiye'))))
    expect(queued[0]).toMatchObject({ lat: 25.6, lon: 85.1 })

    const other = '919800099999'
    await run(post(payload({ id: 'l2', from: other, type: 'location', location: { latitude: 12.9, longitude: 77.6 } })))
    await run(post(payload(text('m3', 'ghar me paani bhar gaya hai, madad chahiye', other))))
    expect(queued[1]).toMatchObject({ lat: null, lon: null })
  })

  it('tells the sender how to report when they send something it cannot read, and queues nothing', async () => {
    await run(post(payload({ id: 'i1', from: NUMBER, type: 'image' })))
    expect(replies[0]).toContain('112')
    expect(queued).toHaveLength(0)
  })

  it('rate-limits one phone and says so, without losing the earlier reports', async () => {
    for (let k = 0; k < 31; k++) await run(post(payload(text('r' + k, 'Rampur me paani aa gaya report number ' + k))))
    expect(queued).toHaveLength(30)
    expect(replies[30]).toContain('बहुत संदेश')
  })

  it('stores a voice note for transcription, and rejects an empty or oversized one', async () => {
    const voice = (id: string) => ({ id, from: NUMBER, type: 'audio', audio: { id: 'media1', mime_type: 'audio/ogg; codecs=opus' } })
    await run(post(payload(voice('a1'))))
    expect(puts).toHaveLength(1)
    expect(puts[0]).toMatch(/^audio\/.+\.ogg$/)
    media.size = 6_000_000
    await run(post(payload(voice('a2'))))
    media.size = 0
    await run(post(payload(voice('a3'))))
    expect(puts).toHaveLength(1)
  })

  it('a failed courtesy reply does not fail the report', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('meta down') }))
    expect((await run(post(payload(text('m9', 'Rampur gaon me paani ghar me ghus gaya, 8 log'))))).statusCode).toBe(200)
    expect(queued).toHaveLength(1)
  })

  it('answers 400 to a signed body that is not JSON', async () => {
    expect((await run(post('{not json'))).statusCode).toBe(400)
  })
})
