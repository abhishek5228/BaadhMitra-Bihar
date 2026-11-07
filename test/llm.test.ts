import { beforeEach, describe, expect, it, vi } from 'vitest'

// The extractor Lambda with a model that answers well, badly, or not at all, and with lost lock races.
const db = new Map<string, Record<string, any>>()
const model = { answer: '' as string | Error }
const lose = { n: 0 }

vi.hoisted(() => {
  process.env.AWS_REGION = 'ap-south-1'
  process.env.TBL = 'tbl'
  process.env.MODEL = 'm'
})

const fake = {
  send: async (cmd: { constructor: { name: string }; input: Record<string, any> }) => {
    const n = cmd.constructor.name
    const i = cmd.input
    const key = (k: { pk: string; sk: string }) => k.pk + '|' + k.sk
    if (n === 'PutCommand') {
      if (String(i.Item.pk).startsWith('I#') && lose.n > 0) {
        lose.n--
        throw Object.assign(new Error('cond'), { name: 'ConditionalCheckFailedException' })
      }
      db.set(key(i.Item), structuredClone(i.Item))
      return {}
    }
    if (n === 'GetCommand') return { Item: db.get(key(i.Key)) }
    if (n === 'UpdateCommand') {
      const row = db.get(key(i.Key)) ?? { ...i.Key }
      const ref = /^ADD\s+(\S+)/.exec(i.UpdateExpression)![1]
      const f = (i.ExpressionAttributeNames?.[ref] as string | undefined) ?? ref
      row[f] = Number(row[f] ?? 0) + (Object.values(i.ExpressionAttributeValues)[0] as number)
      db.set(key(i.Key), row)
      return {}
    }
    if (n === 'PublishCommand') return {}
    throw new Error('unhandled ' + n)
  },
}
vi.mock('@aws-sdk/lib-dynamodb', async () => ({ ...(await vi.importActual<object>('@aws-sdk/lib-dynamodb')), DynamoDBDocumentClient: { from: () => fake } }))
vi.mock('@aws-sdk/client-sns', async () => ({ ...(await vi.importActual<object>('@aws-sdk/client-sns')), SNSClient: class { send = fake.send } }))
vi.mock('@aws-sdk/client-bedrock-runtime', () => ({
  ConverseCommand: class {
    constructor(public input: unknown) {}
  },
  BedrockRuntimeClient: class {
    send = async () => {
      if (model.answer instanceof Error) throw model.answer
      return { output: { message: { content: [{ text: model.answer }] } } }
    }
  },
}))

const msg = (text: string, id = 'm1', who = 'w1') => ({ messageId: id, body: JSON.stringify({ id, text, who, lat: null, lon: null, ts: Date.now() }) })
const incs = () => [...db.values()].filter((r) => String(r.pk).startsWith('I#')).map((r) => r.inc as Record<string, any>)
const stat = (k: string) => Number(db.get('S|G')?.[k] ?? 0)
const good = (o: object = {}) => JSON.stringify({ place: 'Supaul', depth: 120, ppl: 12, needs: ['boat'], vul: false, sev: 4, conf: 0.9, ...o })

beforeEach(() => {
  db.clear()
  lose.n = 0
  model.answer = good()
})

describe('extractor with a model', async () => {
  const run = (await import('../backend/extract')).handler

  it('uses a valid model answer, even when it is wrapped in chatter', async () => {
    model.answer = 'Sure! Here is the JSON:\n```json\n' + good() + '\n```\nHope that helps.'
    expect((await run({ Records: [msg('Supaul me kamar tak paani, 12 log, naav chahiye')] } as any)).batchItemFailures).toEqual([])
    const [inc] = incs()
    expect(inc.snips[0].src).toBe('llm')
    expect(inc).toMatchObject({ sev: 4, ppl: 12 })
    expect(stat('rule')).toBe(0)
  })

  it.each([
    ['text that is not JSON', 'I am sorry, I cannot help with that.'],
    ['a severity outside 1 to 5', good({ sev: 9 })],
    ['a confidence above 1', good({ conf: 7 })],
    ['broken JSON', '{"place": "Supaul", "sev": 4,'],
    ['an empty answer', ''],
  ])('falls back to the rule extractor on %s', async (_n, answer) => {
    model.answer = answer
    await run({ Records: [msg('Supaul me kamar tak paani, 12 log, naav chahiye')] } as any)
    const [inc] = incs()
    expect(inc.snips[0].src).toBe('rule')
    expect(stat('rule')).toBe(1)
  })

  it('falls back when the model call itself fails', async () => {
    model.answer = Object.assign(new Error('slow'), { name: 'TimeoutError' })
    await run({ Records: [msg('Supaul me kamar tak paani, 12 log, naav chahiye')] } as any)
    expect(incs()[0].snips[0].src).toBe('rule')
  })

  it('ignores needs the model invents, keeping only the known ones', async () => {
    model.answer = good({ needs: ['boat', 'helicopter', 'medical', 'boat'] })
    await run({ Records: [msg('Supaul me kamar tak paani, 12 log')] } as any)
    expect([...incs()[0].needs].sort()).toEqual(['boat', 'medical'])
  })

  it('looks in the message when the model names a place the map does not know', async () => {
    model.answer = good({ place: 'Nowhereville' })
    await run({ Records: [msg('Supaul me kamar tak paani, 12 log')] } as any)
    expect(incs()).toHaveLength(1)
    expect(incs()[0].place).toMatch(/Supaul/i)
  })

  it('keeps a report with no place for a human instead of dropping it', async () => {
    model.answer = good({ place: null })
    await run({ Records: [msg('help help paani aa gaya')] } as any)
    expect(incs()).toHaveLength(0)
    expect(stat('unpl')).toBe(1)
    expect([...db.values()].some((r) => String(r.pk).startsWith('U#'))).toBe(true)
  })

  it('retries when another report for the same area wins the race, and fails the message if it keeps losing', async () => {
    lose.n = 2
    expect((await run({ Records: [msg('Supaul me kamar tak paani, 12 log', 'a')] } as any)).batchItemFailures).toEqual([])
    expect(incs()).toHaveLength(1)
    db.clear()
    lose.n = 50
    expect((await run({ Records: [msg('Supaul me kamar tak paani, 12 log', 'b')] } as any)).batchItemFailures).toEqual([{ itemIdentifier: 'b' }])
  })

  it('counts the same sender once and different senders separately for one place', async () => {
    await run({ Records: [msg('Supaul me kamar tak paani, 12 log', 'a', 'w1')] } as any)
    await run({ Records: [msg('Supaul me paani badh raha hai', 'b', 'w1')] } as any)
    await run({ Records: [msg('Supaul me paani ghar me ghus gaya', 'c', 'w2')] } as any)
    expect(incs()).toHaveLength(1)
    expect(incs()[0]).toMatchObject({ n: 2, raw: 3 })
  })
})
