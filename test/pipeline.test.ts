import { beforeEach, describe, expect, it, vi } from 'vitest'

// In-memory stand-in for DynamoDB / SQS / SNS so the real handlers run end to end without AWS.
const db = new Map<string, Record<string, unknown>>()
const sent: string[] = []
const pub: string[] = []

// Mock at the SDK client level (not the helper module) so helpers inside backend/lib/aws.ts
// such as getInc, putInc and bump also hit the fake.
vi.hoisted(() => {
  process.env.AWS_REGION = 'ap-south-1'
  process.env.TBL = 'tbl'
})

const fake = {
  send: async (cmd: { constructor: { name: string }; input: Record<string, any> }) => {
    const key = (k: { pk: string; sk: string }) => k.pk + '|' + k.sk
    const n = cmd.constructor.name
    const i = cmd.input
    if (n === 'PutCommand') {
      const k = key(i.Item)
      const old = db.get(k)
      const c = i.ConditionExpression as string | undefined
      if (c?.startsWith('attribute_not_exists(pk)') && old) {
        const lost = c === 'attribute_not_exists(pk)' || (old.inc as { ver: number }).ver !== i.ExpressionAttributeValues[':v']
        if (lost) throw Object.assign(new Error('cond'), { name: 'ConditionalCheckFailedException' })
      }
      db.set(k, structuredClone(i.Item))
      return {}
    }
    if (n === 'GetCommand') return { Item: db.get(key(i.Key)) }
    if (n === 'UpdateCommand') {
      const k = key(i.Key)
      const row = db.get(k) ?? { ...i.Key }
      if (i.UpdateExpression.startsWith('ADD')) {
        const f = Object.values(i.ExpressionAttributeNames)[0] as string
        row[f] = Number(row[f] ?? 0) + (Object.values(i.ExpressionAttributeValues)[0] as number)
      }
      db.set(k, row)
      return {}
    }
    if (n === 'QueryCommand') {
      const p = i.ExpressionAttributeValues[':p']
      const rows = [...db.values()].filter((r) => r.g1p === p).sort((x, y) => String(x.g1s).localeCompare(String(y.g1s)))
      if (i.ScanIndexForward === false) rows.reverse()
      return { Items: rows.slice(0, i.Limit ?? 50) }
    }
    if (n === 'SendMessageCommand') {
      sent.push(i.MessageBody)
      return {}
    }
    if (n === 'PublishCommand') {
      pub.push(i.Message)
      return {}
    }
    throw new Error('unhandled ' + n)
  },
}

vi.mock('@aws-sdk/lib-dynamodb', async () => ({ ...(await vi.importActual<object>('@aws-sdk/lib-dynamodb')), DynamoDBDocumentClient: { from: () => fake } }))
vi.mock('@aws-sdk/client-sqs', async () => ({ ...(await vi.importActual<object>('@aws-sdk/client-sqs')), SQSClient: class { send = fake.send } }))
vi.mock('@aws-sdk/client-sns', async () => ({ ...(await vi.importActual<object>('@aws-sdk/client-sns')), SNSClient: class { send = fake.send } }))

// Bedrock is "down": the extractor must fall back to the rule extractor.
vi.mock('@aws-sdk/client-bedrock-runtime', () => ({
  BedrockRuntimeClient: class {
    send = async () => {
      throw Object.assign(new Error('throttled'), { name: 'ThrottlingException' })
    }
  },
  ConverseCommand: class {
    constructor(public input: unknown) {}
  },
}))

process.env.QURL = 'q'
process.env.TOPIC = 'arn:topic'
process.env.MODEL = 'm'

const ev = (resource: string, method: string, b?: unknown, pp?: Record<string, string>) =>
  ({ resource, httpMethod: method, body: b === undefined ? null : JSON.stringify(b), pathParameters: pp ?? null, requestContext: { identity: { sourceIp: '1.2.3.4' } } }) as any

beforeEach(() => {
  db.clear()
  sent.length = 0
  pub.length = 0
})

describe('text report -> queue -> extractor -> dispatcher API', async () => {
  const ing = (await import('../backend/ingest')).handler
  const ext = (await import('../backend/extract')).handler
  const api = (await import('../backend/api')).handler

  const drain = async () => {
    const recs = sent.splice(0).map((body, k) => ({ messageId: 'm' + k, body }))
    return ext({ Records: recs } as any)
  }

  it('accepts a report, redacts PII, and builds a ranked incident', async () => {
    const r = await ing(ev('/reports', 'POST', { text: 'सुपौल में पानी कमर तक है, 20 लोग फंसे, नाव चाहिए. call 98765 43210', sender: 'u1' }))
    expect(r.statusCode).toBe(202)
    expect(sent[0]).not.toContain('98765')
    const res = await drain()
    expect(res.batchItemFailures).toEqual([])

    const list = JSON.parse((await api(ev('/incidents', 'GET'))).body)
    expect(list.items).toHaveLength(1)
    expect(list.items[0].place).toBe('Supaul')
    expect(list.items[0].snips[0].src).toBe('rule') // Bedrock was down
    expect(list.items[0].who).toBeUndefined() // hashed sender ids are never exposed
    expect(JSON.parse((await api(ev('/stats', 'GET'))).body)).toMatchObject({ reports: 1, rule: 1, incidents: 1 })
  })

  it('treats an identical resend as a duplicate and counts a repeat sender once', async () => {
    const b = { text: 'Kursela me paani chhat par, 6 log, naav chahiye', sender: 'u1' }
    expect((await ing(ev('/reports', 'POST', b))).statusCode).toBe(202)
    const dup = await ing(ev('/reports', 'POST', b))
    expect(JSON.parse(dup.body).dup).toBe(true)
    expect(sent).toHaveLength(1)
    await ing(ev('/reports', 'POST', { ...b, text: b.text + ' jaldi' })) // same person, new words
    await ing(ev('/reports', 'POST', { ...b, sender: 'u2' }))
    await drain()
    const inc = JSON.parse((await api(ev('/incidents', 'GET'))).body).items[0]
    expect(inc.n).toBe(2) // two people
    expect(inc.raw).toBe(3) // three reports
  })

  it('keeps unplaceable reports for a human instead of dropping them', async () => {
    await ing(ev('/reports', 'POST', { text: 'please help us water is rising', sender: 'u9' }))
    await drain()
    expect(JSON.parse((await api(ev('/incidents', 'GET'))).body).items).toHaveLength(0)
    const un = JSON.parse((await api(ev('/unplaced', 'GET'))).body).items
    expect(un).toHaveLength(1)
    expect(JSON.parse((await api(ev('/stats', 'GET'))).body).unpl).toBe(1)
  })

  it('uses a phone GPS pin over the text, and rejects pins outside Bihar', async () => {
    await ing(ev('/reports', 'POST', { text: 'paani bhar gaya hai, 5 log', sender: 'g1', lat: 25.9, lon: 86.6 }))
    await ing(ev('/reports', 'POST', { text: 'paani bhar gaya hai, 5 log', sender: 'g2', lat: 28.6, lon: 77.2 })) // Delhi: ignored
    await drain()
    const items = JSON.parse((await api(ev('/incidents', 'GET'))).body).items
    expect(items).toHaveLength(1) // the Delhi one had no usable location
  })

  it('assign lowers the score; resolve removes it from the queue', async () => {
    await ing(ev('/reports', 'POST', { text: 'Khagaria: 25 log phanse hain, paani gardan tak, boat urgently', sender: 'k1' }))
    await drain()
    const a = JSON.parse((await api(ev('/incidents', 'GET'))).body).items[0]
    const as = JSON.parse((await api(ev('/incidents/{id}/assign', 'POST', { team: 'NDRF Team A' }, { id: a.id }))).body)
    expect(as.status).toBe('assigned')
    expect(as.score).toBeLessThan(a.score)
    await api(ev('/incidents/{id}/resolve', 'POST', {}, { id: a.id }))
    expect(JSON.parse((await api(ev('/incidents', 'GET'))).body).items).toHaveLength(0)
  })

  it('alerts the ops topic once when an incident first crosses priority 75', async () => {
    const t = 'Khagaria: 25 log phanse hain, paani gardan tak, bachche aur bujurg, naav chahiye'
    for (const u of ['a', 'b', 'c']) await ing(ev('/reports', 'POST', { text: t, sender: u }))
    await drain()
    expect(pub.filter((m) => m.includes('Khagaria')).length).toBe(1)
  })

  it('rejects bad input', async () => {
    expect((await ing(ev('/reports', 'POST', { text: 'x' }))).statusCode).toBe(400)
    expect((await ing({ ...ev('/reports', 'POST'), body: '{bad' })).statusCode).toBe(400)
    expect((await ing(ev('/upload-url', 'POST', { ext: 'exe' }))).statusCode).toBe(400)
    expect((await api(ev('/nope', 'GET'))).statusCode).toBe(404)
  })
})
