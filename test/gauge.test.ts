import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Runs the real gauge poller against an in-memory table, with the feed, Polly and S3 replaced.
const db = new Map<string, Record<string, unknown>>()
const pub: string[] = []
const polly = { fail: false }

vi.hoisted(() => {
  process.env.AWS_REGION = 'ap-south-1'
  process.env.TBL = 'tbl'
  process.env.TOPIC = 'arn:topic'
  process.env.BKT = 'bkt'
})

const fake = {
  send: async (cmd: { constructor: { name: string }; input: Record<string, any> }) => {
    const n = cmd.constructor.name
    const i = cmd.input
    if (n === 'PutCommand') {
      db.set(i.Item.pk + '|' + i.Item.sk, structuredClone(i.Item))
      return {}
    }
    if (n === 'GetCommand') return { Item: db.get(i.Key.pk + '|' + i.Key.sk) }
    if (n === 'QueryCommand') {
      const p = i.ExpressionAttributeValues[':p']
      return { Items: [...db.values()].filter((r) => r.g1p === p).sort((a, b) => String(a.g1s).localeCompare(String(b.g1s))) }
    }
    if (n === 'PublishCommand') {
      pub.push(i.Message)
      return {}
    }
    if (n === 'PutObjectCommand') return {}
    throw new Error('unhandled ' + n)
  },
}
vi.mock('@aws-sdk/lib-dynamodb', async () => ({ ...(await vi.importActual<object>('@aws-sdk/lib-dynamodb')), DynamoDBDocumentClient: { from: () => fake } }))
vi.mock('@aws-sdk/client-sns', async () => ({ ...(await vi.importActual<object>('@aws-sdk/client-sns')), SNSClient: class { send = fake.send } }))
vi.mock('@aws-sdk/client-s3', async () => ({ ...(await vi.importActual<object>('@aws-sdk/client-s3')), S3Client: class { send = fake.send } }))
vi.mock('@aws-sdk/client-polly', async () => ({
  ...(await vi.importActual<object>('@aws-sdk/client-polly')),
  PollyClient: class {
    send = async () => {
      if (polly.fail) throw Object.assign(new Error('nope'), { name: 'PollyDown' })
      return { AudioStream: { transformToByteArray: async () => new Uint8Array([1, 2, 3]) } }
    }
  },
}))

const T0 = Date.UTC(2026, 7, 1, 6, 0, 0)
const HOUR = 3_600_000
const gauges = () => [...db.values()].filter((r) => r.g1p === 'GAUGE').map((r) => r.g as Record<string, any>)
const alerts = () => [...db.values()].filter((r) => r.g1p === 'ALERT')
const feed = (rows: unknown[], ok = true) => vi.stubGlobal('fetch', vi.fn(async () => ({ ok, json: async () => rows })))
const row = (lvl: number, extra: Record<string, unknown> = {}) => ({ id: 'st1', name: 'Test Ghat', river: 'Ganga', lat: 25.6, lon: 85.1, lvl, danger: 50, ...extra })

beforeEach(() => {
  db.clear()
  pub.length = 0
  polly.fail = false
  delete process.env.FEED
  delete process.env.FEED_PARTIAL
  delete process.env.FEED_STALE_H
  vi.useFakeTimers()
  vi.setSystemTime(T0)
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('gauge poller', async () => {
  const run = (await import('../backend/gauge')).handler

  it('with no feed configured, every reading is simulated and says so', async () => {
    await run()
    const gs = gauges()
    expect(gs.length).toBe(6)
    expect(gs.every((g) => g.sim === true)).toBe(true)
  })

  it('stores a history row per reading and sends each alert to the topic with Hindi first', async () => {
    await run()
    expect([...db.keys()].filter((k) => k.includes('|H#')).length).toBe(6)
    expect(pub.length).toBe(alerts().length)
    for (const m of pub) expect(m).toMatch(/^बाढ़/)
  })

  it('does not alert again while nothing has escalated', async () => {
    await run()
    const first = pub.length
    vi.setSystemTime(T0 + 60_000)
    await run()
    expect(pub.length).toBe(first)
  })

  it('a real feed: the first reading never alerts (no trend yet), a rising escalation alerts once', async () => {
    process.env.FEED = 'https://feed.test/x'
    feed([row(48.2)]) // 1.8 m below danger: normal
    await run()
    expect(pub.length).toBe(0)
    expect(gauges()[0]).toMatchObject({ sim: false, state: 'normal', trend: 0 })
    vi.setSystemTime(T0 + HOUR)
    feed([row(49.5)]) // warn, rising 1.3 m/h
    await run()
    expect(pub.length).toBe(1)
    expect(gauges()[0]).toMatchObject({ state: 'warn', trend: 1.3 })
    vi.setSystemTime(T0 + 2 * HOUR)
    feed([row(49.7)]) // still warn: no second alert
    await run()
    expect(pub.length).toBe(1)
    vi.setSystemTime(T0 + 3 * HOUR)
    feed([row(50.4)]) // danger: escalation
    await run()
    expect(pub.length).toBe(2)
    expect(pub[1]).toContain('Flood danger')
  })

  it('a river that is falling does not trigger a warning even if it is above the line', async () => {
    process.env.FEED = 'https://feed.test/x'
    feed([row(50.8)])
    await run()
    vi.setSystemTime(T0 + HOUR)
    feed([row(50.2)])
    await run()
    expect(pub.length).toBe(0)
    expect(gauges()[0].state).toBe('danger')
  })

  it('when the feed is down, real readings are kept, greyed out as stale, and nothing is invented', async () => {
    process.env.FEED = 'https://feed.test/x'
    feed([row(49.5)])
    await run()
    vi.setSystemTime(T0 + HOUR)
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    await run()
    const g = gauges()
    expect(g).toHaveLength(1)
    expect(g[0]).toMatchObject({ lvl: 49.5, stale: true, sim: false })
    expect(pub.length).toBe(0)
  })

  it('a bad answer from the feed counts as down, not as zero readings', async () => {
    process.env.FEED = 'https://feed.test/x'
    feed([row(49.5)])
    await run()
    feed([], true) // empty list
    await run()
    expect(gauges()[0].stale).toBe(true)
    feed([row(49.5)], false) // HTTP error
    await run()
    expect(gauges()[0].stale).toBe(true)
  })

  it('an old reading is marked stale and never alerts', async () => {
    process.env.FEED = 'https://feed.test/x'
    feed([row(48.0, { ts: T0 - 10 * HOUR })])
    await run()
    vi.setSystemTime(T0 + HOUR)
    feed([row(50.6, { ts: T0 - 9 * HOUR })])
    await run()
    expect(gauges()[0].stale).toBe(true)
    expect(pub.length).toBe(0)
  })

  it('still sends the text alert when the voice service fails', async () => {
    process.env.FEED = 'https://feed.test/x'
    polly.fail = true
    feed([row(48.2)])
    await run()
    vi.setSystemTime(T0 + HOUR)
    feed([row(50.5)])
    await run()
    expect(pub.length).toBe(1)
    expect(alerts()[0]).toBeDefined()
    expect((alerts()[0] as { akey?: string }).akey).toBeUndefined()
  })

  it('drops implausible readings from a feed instead of storing them', async () => {
    process.env.FEED = 'https://feed.test/x'
    feed([row(49.5), { id: 'bad', lvl: 'x', danger: 50 }, row(900, { id: 'wild' })])
    await run()
    expect(gauges().map((g) => g.id)).toEqual(['st1'])
  })
  it('a bulletin-style feed (partial): an empty list is valid and greys what is no longer listed', async () => {
    process.env.FEED = 'https://feed.test/x'
    process.env.FEED_PARTIAL = 'true'
    feed([row(49.5), row(40, { id: 'st2', name: 'Other Ghat' })])
    await run()
    vi.setSystemTime(T0 + HOUR)
    feed([row(49.6)]) // st2 is not listed any more
    await run()
    const by = Object.fromEntries(gauges().map((g) => [g.id, g]))
    expect(by.st1.stale).toBeFalsy()
    expect(by.st2.stale).toBe(true)
    vi.setSystemTime(T0 + 2 * HOUR)
    feed([]) // nothing above warning today
    await run()
    expect(gauges().every((g) => g.stale === true)).toBe(true)
    expect(pub.length).toBe(0)
  })

  it('without the partial setting, a station missing from the list is left alone', async () => {
    process.env.FEED = 'https://feed.test/x'
    feed([row(49.5), row(40, { id: 'st2', name: 'Other Ghat' })])
    await run()
    vi.setSystemTime(T0 + HOUR)
    feed([row(49.6)])
    await run()
    expect(gauges().find((g) => g.id === 'st2')?.stale).toBeFalsy()
  })

  it('a daily feed can set how old a reading may be: 30 h is fresh, 40 h is stale, and the default is 3 h', async () => {
    process.env.FEED = 'https://feed.test/x'
    process.env.FEED_STALE_H = '30'
    feed([row(48, { ts: T0 - 20 * HOUR })])
    await run()
    expect(gauges()[0].stale).toBe(false)
    feed([row(48, { ts: T0 - 40 * HOUR })])
    await run()
    expect(gauges()[0].stale).toBe(true)
    delete process.env.FEED_STALE_H
    feed([row(48, { ts: T0 - 20 * HOUR })])
    await run()
    expect(gauges()[0].stale).toBe(true)
  })

  it('a nonsense stale setting falls back to 3 h', async () => {
    process.env.FEED = 'https://feed.test/x'
    process.env.FEED_STALE_H = 'abc'
    feed([row(48, { ts: T0 - 2 * HOUR })])
    await run()
    expect(gauges()[0].stale).toBe(false)
    feed([row(48, { ts: T0 - 4 * HOUR })])
    await run()
    expect(gauges()[0].stale).toBe(true)
  })
})
