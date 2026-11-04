import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda'
import { GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb'
import { StartMessageMoveTaskCommand } from '@aws-sdk/client-sqs'
import { SubscribeCommand } from '@aws-sdk/client-sns'
import { GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { TBL, bad, body, ddb, env, getInc, listInc, ok, putInc, s3, sns, sqs, strip } from './lib/aws'
import { score } from '../shared/score'
import type { Alert, Gauge, Stats } from '../shared/types'

async function q(p: string, lim: number, desc = false) {
  const r = await ddb.send(
    new QueryCommand({
      TableName: TBL(),
      IndexName: 'gsi1',
      KeyConditionExpression: 'g1p = :p',
      ExpressionAttributeValues: { ':p': p },
      ScanIndexForward: !desc,
      Limit: lim,
    }),
  )
  return r.Items ?? []
}

/** Change an incident's status with the same optimistic lock the extractor uses. */
async function setStatus(id: string, st: 'assigned' | 'resolved', team?: string): Promise<APIGatewayProxyResult> {
  for (let k = 0; k < 4; k++) {
    const old = await getInc(id)
    if (!old) return bad('no such incident', 404)
    const nxt = { ...old, status: st, team: st === 'assigned' ? team : old.team, ver: old.ver + 1 }
    nxt.score = score(nxt)
    if (await putInc(nxt)) return ok(strip(nxt))
  }
  return bad('busy, try again', 409)
}

export const handler = async (e: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const route = `${e.httpMethod} ${e.resource}`
  const b = body(e.body)

  switch (route) {
    case 'GET /incidents': {
      const all = await listInc(150)
      return ok({ items: all.filter((i) => i.status !== 'resolved').map(strip) })
    }

    case 'POST /incidents/{id}/assign': {
      const team = typeof b?.team === 'string' ? b.team.trim().slice(0, 40) : ''
      if (!team) return bad('team required')
      return setStatus(e.pathParameters?.id ?? '', 'assigned', team)
    }

    case 'POST /incidents/{id}/resolve':
      return setStatus(e.pathParameters?.id ?? '', 'resolved')

    case 'GET /gauges': {
      const it = await q('GAUGE', 50)
      return ok({ items: it.map((x) => x.g as Gauge) })
    }

    case 'GET /alerts': {
      const it = await q('ALERT', 15, true)
      const items: Alert[] = await Promise.all(
        it.map(async (x) => {
          const a = x.a as Alert
          const key = x.akey as string | undefined
          const audio = key ? await getSignedUrl(s3, new GetObjectCommand({ Bucket: env('BKT'), Key: key }), { expiresIn: 3600 }) : undefined
          return { ...a, audio }
        }),
      )
      return ok({ items })
    }

    case 'GET /stats': {
      const s = (await ddb.send(new GetCommand({ TableName: TBL(), Key: { pk: 'S', sk: 'G' } }))).Item ?? {}
      const inc = (await listInc(150)).length
      const reports = Number(s.reports ?? 0)
      const out: Stats & { unpl: number } = {
        reports,
        incidents: inc,
        rule: Number(s.rule ?? 0),
        review: Number(s.review ?? 0),
        dedup: reports > 0 ? Math.max(0, Math.round((1 - inc / reports) * 100) / 100) : 0,
        unpl: Number(s.unpl ?? 0),
      }
      return ok(out)
    }

    case 'GET /unplaced': {
      const it = await q('UNPL', 30, true)
      return ok({ items: it.map((x) => ({ id: String(x.pk).slice(2), t: x.t, ts: x.ts })) })
    }

    case 'POST /subscribe': {
      const em = typeof b?.email === 'string' ? b.email.trim() : ''
      const ph = typeof b?.phone === 'string' ? b.phone.trim() : ''
      if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) {
        await sns.send(new SubscribeCommand({ TopicArn: env('TOPIC'), Protocol: 'email', Endpoint: em }))
        return ok({ ok: true, note: 'confirm via the email AWS sends you' }, 202)
      }
      if (/^\+91[6-9]\d{9}$/.test(ph)) {
        await sns.send(new SubscribeCommand({ TopicArn: env('TOPIC'), Protocol: 'sms', Endpoint: ph }))
        return ok({ ok: true }, 202)
      }
      return bad('send email, or phone like +919876543210')
    }

    case 'POST /admin/replay': {
      // Redrive everything in the dead-letter queue back to the main queue.
      const r = await sqs.send(new StartMessageMoveTaskCommand({ SourceArn: env('DLQ_ARN'), DestinationArn: env('Q_ARN') }))
      return ok({ task: r.TaskHandle }, 202)
    }

    default:
      return bad('not found', 404)
  }
}
