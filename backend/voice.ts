import type { EventBridgeEvent, S3Event } from 'aws-lambda'
import { StartTranscriptionJobCommand, TranscribeClient } from '@aws-sdk/client-transcribe'
import { GetObjectCommand } from '@aws-sdk/client-s3'
import { GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb'
import { SendMessageCommand } from '@aws-sdk/client-sqs'
import { TBL, bump, ddb, emf, env, s3, sqs } from './lib/aws'
import { redact } from '../shared/redact'
import type { Msg } from './ingest'

const tr = new TranscribeClient({})

/** S3 trigger: a voice note finished uploading, start transcription. */
export const onAudio = async (e: S3Event): Promise<void> => {
  for (const r of e.Records) {
    const key = decodeURIComponent(r.s3.object.key.replace(/\+/g, ' '))
    const m = /^audio\/([a-z0-9]+)\.(webm|ogg|mp3|wav|m4a|amr)$/.exec(key)
    if (!m) continue
    const [, id, ext] = m
    await tr.send(
      new StartTranscriptionJobCommand({
        TranscriptionJobName: 'bm-' + id,
        // Callers speak Hindi mostly; Maithili and Bhojpuri are not supported languages in
        // Transcribe, so Hindi is the closest model. Low confidence downstream catches the rest.
        IdentifyLanguage: true,
        LanguageOptions: ['hi-IN', 'en-IN'],
        Media: { MediaFileUri: `s3://${env('BKT')}/${key}` },
        MediaFormat: ext === 'm4a' ? 'm4a' : (ext as 'mp3'),
        OutputBucketName: env('BKT'),
        OutputKey: `transcripts/${id}.json`,
      }),
    )
    emf('VoiceStarted', 1)
  }
}

interface Done {
  TranscriptionJobName: string
  TranscriptionJobStatus: 'COMPLETED' | 'FAILED'
}

/** EventBridge: Transcribe finished. Read the transcript, redact, hand to the same SQS pipeline as text. */
export const onDone = async (e: EventBridgeEvent<'Transcribe Job State Change', Done>): Promise<void> => {
  const name = e.detail.TranscriptionJobName
  if (!name.startsWith('bm-')) return
  const id = name.slice(3)
  const key = { pk: 'R#' + id, sk: 'M' }

  if (e.detail.TranscriptionJobStatus === 'FAILED') {
    await ddb.send(new UpdateCommand({ TableName: TBL(), Key: key, UpdateExpression: 'SET st = :s', ExpressionAttributeValues: { ':s': 'fail' } }))
    emf('VoiceFailed', 1)
    return
  }

  const meta = (await ddb.send(new GetCommand({ TableName: TBL(), Key: key }))).Item
  if (!meta || meta.st !== 'wait') return // unknown or already handled (EventBridge may deliver twice)

  const obj = await s3.send(new GetObjectCommand({ Bucket: env('BKT'), Key: `transcripts/${id}.json` }))
  const js = JSON.parse((await obj.Body?.transformToString()) ?? '{}')
  const raw: string = js?.results?.transcripts?.[0]?.transcript ?? ''
  const text = redact(raw).slice(0, 1000)
  if (text.length < 3) {
    await ddb.send(new UpdateCommand({ TableName: TBL(), Key: key, UpdateExpression: 'SET st = :s', ExpressionAttributeValues: { ':s': 'empty' } }))
    return
  }

  // Claim the report atomically so a duplicate event cannot enqueue it twice.
  try {
    await ddb.send(
      new UpdateCommand({
        TableName: TBL(),
        Key: key,
        UpdateExpression: 'SET st = :q, t = :t',
        ConditionExpression: 'st = :w',
        ExpressionAttributeValues: { ':q': 'queued', ':w': 'wait', ':t': text },
      }),
    )
  } catch (err) {
    if ((err as { name?: string }).name === 'ConditionalCheckFailedException') return
    throw err
  }

  const msg: Msg = { id, text, who: meta.who as string, lat: (meta.lat as number | null) ?? null, lon: (meta.lon as number | null) ?? null, ts: Date.now() }
  await sqs.send(new SendMessageCommand({ QueueUrl: env('QURL'), MessageBody: JSON.stringify(msg) }))
  await bump('reports')
  emf('VoiceTranscribed', 1)
}
