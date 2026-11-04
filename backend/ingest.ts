import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda'
import { PutCommand } from '@aws-sdk/lib-dynamodb'
import { SendMessageCommand } from '@aws-sdk/client-sqs'
import { PutObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { TBL, bad, body, bump, ddb, emf, env, ok, rid, s3, sha, sqs } from './lib/aws'
import { redact } from '../shared/redact'
import { pin } from '../shared/extract'

const EXT: Record<string, string> = {
  webm: 'audio/webm',
  ogg: 'audio/ogg',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  amr: 'audio/amr',
}

/** Message that travels through SQS to the extractor. Text is already redacted. */
export interface Msg {
  id: string
  text: string
  who: string
  lat: number | null
  lon: number | null
  ts: number
}

function who(e: APIGatewayProxyEvent, b: Record<string, unknown>): string {
  const s = typeof b.sender === 'string' && b.sender ? b.sender.slice(0, 80) : (e.requestContext?.identity?.sourceIp ?? 'anon')
  return sha(env('SALT', 'bm') + s)
}

export const handler = async (e: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const b = body(e.body)
  if (!b) return bad('JSON body required')
  const wh = who(e, b)
  const p = pin(b.lat, b.lon)
  const now = Date.now()

  // ---- POST /upload-url : voice note, goes S3 -> Transcribe -> SQS --------
  if (e.resource === '/upload-url') {
    const ext = typeof b.ext === 'string' ? b.ext.toLowerCase() : ''
    if (!EXT[ext]) return bad('ext must be one of ' + Object.keys(EXT).join(','))
    const id = rid()
    const key = `audio/${id}.${ext}`
    await ddb.send(
      new PutCommand({
        TableName: TBL(),
        Item: { pk: 'R#' + id, sk: 'M', who: wh, lat: p?.lat ?? null, lon: p?.lon ?? null, st: 'wait', ts: now, ttl: Math.floor(now / 1000) + 7 * 86400 },
      }),
    )
    const url = await getSignedUrl(s3, new PutObjectCommand({ Bucket: env('BKT'), Key: key, ContentType: EXT[ext] }), { expiresIn: 300 })
    return ok({ id, url, key, type: EXT[ext] }, 201)
  }

  // ---- POST /reports : text -------------------------------------------------
  const raw = typeof b.text === 'string' ? b.text : ''
  if (raw.trim().length < 3 || raw.length > 1000) return bad('text must be 3 to 1000 characters')
  const text = redact(raw.slice(0, 1000))

  // Idempotency: the same sender sending the same words within 10 minutes is one report.
  // (Clients and mobile networks retry; we must not double count a family in trouble.)
  const k = sha(wh + text.toLowerCase() + Math.floor(now / 600_000))
  const id = rid()
  try {
    await ddb.send(
      new PutCommand({
        TableName: TBL(),
        Item: { pk: 'K#' + k, sk: 'K', id, ttl: Math.floor(now / 1000) + 3600 },
        ConditionExpression: 'attribute_not_exists(pk)',
      }),
    )
  } catch (err) {
    if ((err as { name?: string }).name === 'ConditionalCheckFailedException') {
      emf('DuplicateReports', 1)
      return ok({ dup: true }, 200)
    }
    throw err
  }

  const msg: Msg = { id, text, who: wh, lat: p?.lat ?? null, lon: p?.lon ?? null, ts: now }
  await ddb.send(
    new PutCommand({
      TableName: TBL(),
      Item: { pk: 'R#' + id, sk: 'M', who: wh, t: text, st: 'queued', ts: now, ttl: Math.floor(now / 1000) + 7 * 86400 },
    }),
  )
  await sqs.send(new SendMessageCommand({ QueueUrl: env('QURL'), MessageBody: JSON.stringify(msg) }))
  await bump('reports')
  emf('ReportsIn', 1)
  return ok({ id }, 202)
}
