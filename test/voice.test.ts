import { beforeEach, describe, expect, it, vi } from 'vitest'

// The voice-note Lambdas: S3 upload starts a Transcribe job, and the finished job feeds the same queue as text.
const db = new Map<string, Record<string, any>>()
const queued: Array<Record<string, any>> = []
const jobs: Array<Record<string, any>> = []
const files = new Map<string, string>()

vi.hoisted(() => {
  process.env.AWS_REGION = 'ap-south-1'
  process.env.TBL = 'tbl'
  process.env.QURL = 'q'
  process.env.BKT = 'bkt'
})

const fake = {
  send: async (cmd: { constructor: { name: string }; input: Record<string, any> }) => {
    const n = cmd.constructor.name
    const i = cmd.input
    const key = (k: { pk: string; sk: string }) => k.pk + '|' + k.sk
    if (n === 'GetCommand') return { Item: db.get(key(i.Key)) }
    if (n === 'PutCommand') {
      db.set(key(i.Item), structuredClone(i.Item))
      return {}
    }
    if (n === 'UpdateCommand') {
      const k = key(i.Key)
      const row = db.get(k) ?? { ...i.Key }
      const v = i.ExpressionAttributeValues
      if (i.UpdateExpression.startsWith('ADD')) {
        const ref = /^ADD\s+(\S+)/.exec(i.UpdateExpression)![1]
        const f = (i.ExpressionAttributeNames?.[ref] as string | undefined) ?? ref
        row[f] = Number(row[f] ?? 0) + (Object.values(v)[0] as number)
      } else if (i.UpdateExpression.startsWith('SET st = :q')) {
        if (row.st !== v[':w']) throw Object.assign(new Error('cond'), { name: 'ConditionalCheckFailedException' })
        row.st = v[':q']
        row.t = v[':t']
      } else row.st = v[':s']
      db.set(k, row)
      return {}
    }
    if (n === 'SendMessageCommand') {
      queued.push(JSON.parse(i.MessageBody))
      return {}
    }
    if (n === 'StartTranscriptionJobCommand') {
      jobs.push(i)
      return {}
    }
    if (n === 'GetObjectCommand') {
      const body = files.get(i.Key)
      if (body === undefined) throw Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey' })
      return { Body: { transformToString: async () => body } }
    }
    throw new Error('unhandled ' + n)
  },
}
vi.mock('@aws-sdk/lib-dynamodb', async () => ({ ...(await vi.importActual<object>('@aws-sdk/lib-dynamodb')), DynamoDBDocumentClient: { from: () => fake } }))
vi.mock('@aws-sdk/client-sqs', async () => ({ ...(await vi.importActual<object>('@aws-sdk/client-sqs')), SQSClient: class { send = fake.send } }))
vi.mock('@aws-sdk/client-s3', async () => ({ ...(await vi.importActual<object>('@aws-sdk/client-s3')), S3Client: class { send = fake.send } }))
vi.mock('@aws-sdk/client-transcribe', async () => ({ ...(await vi.importActual<object>('@aws-sdk/client-transcribe')), TranscribeClient: class { send = fake.send } }))

const s3ev = (...keys: string[]) => ({ Records: keys.map((k) => ({ s3: { object: { key: k } } })) }) as any
const done = (name: string, status: 'COMPLETED' | 'FAILED' = 'COMPLETED') => ({ detail: { TranscriptionJobName: name, TranscriptionJobStatus: status } }) as any
const transcript = (t: string) => JSON.stringify({ results: { transcripts: [{ transcript: t }] } })
const wait = (id: string, extra: Record<string, unknown> = {}) => db.set(`R#${id}|M`, { pk: 'R#' + id, sk: 'M', who: 'w1', st: 'wait', lat: 25.6, lon: 85.1, ...extra })

beforeEach(() => {
  db.clear()
  queued.length = 0
  jobs.length = 0
  files.clear()
})

describe('voice notes', async () => {
  const { onAudio, onDone } = await import('../backend/voice')

  it('starts one transcription job per uploaded audio file, in Hindi or English', async () => {
    await onAudio(s3ev('audio/abc123.ogg', 'audio/def456.m4a'))
    expect(jobs).toHaveLength(2)
    expect(jobs[0]).toMatchObject({ TranscriptionJobName: 'bm-abc123', MediaFormat: 'ogg', LanguageOptions: ['hi-IN', 'en-IN'] })
    expect(jobs[1].MediaFormat).toBe('m4a')
    expect(jobs[0].Media.MediaFileUri).toBe('s3://bkt/audio/abc123.ogg')
  })

  it('ignores files that are not voice notes, and decodes the key S3 sends', async () => {
    await onAudio(s3ev('transcripts/abc.json', 'audio/abc.exe', 'audio/sub/abc.ogg', 'other/abc.ogg'))
    expect(jobs).toHaveLength(0)
    await onAudio(s3ev('audio/ab%63123.mp3'))
    expect(jobs[0].TranscriptionJobName).toBe('bm-abc123')
  })

  it('a finished job becomes a queued report carrying the sender and pin', async () => {
    wait('v1')
    files.set('transcripts/v1.json', transcript('Rampur me paani aa gaya hai, 8 log phase hain'))
    await onDone(done('bm-v1'))
    expect(queued).toHaveLength(1)
    expect(queued[0]).toMatchObject({ id: 'v1', who: 'w1', lat: 25.6, lon: 85.1 })
    expect(queued[0].text).toContain('Rampur')
    expect(db.get('R#v1|M')!.st).toBe('queued')
  })

  it('removes phone numbers from the transcript before it is stored or queued', async () => {
    wait('v2')
    files.set('transcripts/v2.json', transcript('mera number 9876543210 hai Rampur me paani aa gaya'))
    await onDone(done('bm-v2'))
    expect(queued[0].text).not.toContain('9876543210')
    expect(db.get('R#v2|M')!.t).not.toContain('9876543210')
  })

  it('a duplicate "done" event does not queue the report twice', async () => {
    wait('v3')
    files.set('transcripts/v3.json', transcript('Rampur me paani aa gaya hai'))
    await onDone(done('bm-v3'))
    await onDone(done('bm-v3'))
    expect(queued).toHaveLength(1)
  })

  it('a failed job is marked failed and nothing is queued', async () => {
    wait('v4')
    await onDone(done('bm-v4', 'FAILED'))
    expect(db.get('R#v4|M')!.st).toBe('fail')
    expect(queued).toHaveLength(0)
  })

  it('an empty or near-empty transcript is marked empty, not queued', async () => {
    wait('v5')
    files.set('transcripts/v5.json', transcript('  '))
    await onDone(done('bm-v5'))
    expect(db.get('R#v5|M')!.st).toBe('empty')
    expect(queued).toHaveLength(0)
  })

  it('ignores jobs that are not ours and reports it does not know', async () => {
    await onDone(done('someone-elses-job'))
    await onDone(done('bm-unknown'))
    expect(queued).toHaveLength(0)
  })

  it('caps the transcript length', async () => {
    wait('v6')
    files.set('transcripts/v6.json', transcript('paani '.repeat(500)))
    await onDone(done('bm-v6'))
    expect(queued[0].text.length).toBeLessThanOrEqual(1000)
  })
})
