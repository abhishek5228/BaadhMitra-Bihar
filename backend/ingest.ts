import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda'
import { PutObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { bad, body, env, ok, s3, sha } from './lib/aws'
import { accept, allow, voiceMeta } from './lib/intake'
import { pin } from '../shared/extract'

export type { Msg } from './lib/intake'

const EXT: Record<string, string> = {
  webm: 'audio/webm',
  ogg: 'audio/ogg',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  amr: 'audio/amr',
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

  // POST /upload-url : voice note goes browser -> S3 -> Transcribe -> SQS
  if (e.resource === '/upload-url') {
    const ext = typeof b.ext === 'string' ? b.ext.toLowerCase() : ''
    if (!EXT[ext]) return bad('ext must be one of ' + Object.keys(EXT).join(','))
    if (!(await allow(wh))) return bad('too many reports from this sender, try again later', 429)
    const id = await voiceMeta(wh, p)
    const key = `audio/${id}.${ext}`
    const url = await getSignedUrl(s3, new PutObjectCommand({ Bucket: env('BKT'), Key: key, ContentType: EXT[ext] }), { expiresIn: 300 })
    return ok({ id, url, key, type: EXT[ext] }, 201)
  }

  // POST /reports : text
  const raw = typeof b.text === 'string' ? b.text : ''
  if (raw.trim().length < 3 || raw.length > 1000) return bad('text must be 3 to 1000 characters')
  const r = await accept(raw, wh, p)
  if (r.ok) return ok({ id: r.id }, 202)
  if (r.why === 'dup') return ok({ dup: true }, 200)
  if (r.why === 'rate') return bad('too many reports from this sender, try again later', 429)
  return bad('text too short')
}
