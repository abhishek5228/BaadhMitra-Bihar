import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda'
import { GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb'
import { StartMessageMoveTaskCommand } from '@aws-sdk/client-sqs'
import { SubscribeCommand } from '@aws-sdk/client-sns'
import { GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { TBL, allInc, bad, body, ddb, env, getInc, listInc, ok, pad, putInc, rid, s3, sns, sqs, strip } from './lib/aws'
import { score } from '../shared/score'
import { metrics } from '../shared/sla'
import { inBihar } from '../shared/geo'
import type { Alert, AuditRow, Fb, Gauge, Inc, Stats, Team, Wrong } from '../shared/types'
import { WRONGS } from '../shared/types'
import { audit, can, whoami, type Act, type Who } from './lib/auth'

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

/**
 * Read-modify-write an incident under the same optimistic lock the extractor uses.
 * `fn` returns the changed incident, or a Response to refuse (wrong team, wrong state).
 */
async function edit(id: string, fn: (i: Inc, now: number) => Inc | APIGatewayProxyResult): Promise<{ inc: Inc } | { err: APIGatewayProxyResult }> {
  for (let k = 0; k < 4; k++) {
    const old = await getInc(id)
    if (!old) return { err: bad('no such incident', 404) }
    const now = Date.now()
    const r = fn(old, now)
    if ('statusCode' in r) return { err: r }
    const nxt = { ...r, ver: old.ver + 1 }
    nxt.score = score(nxt, now)
    if (await putInc(nxt)) return { inc: nxt }
  }
  return { err: bad('busy, try again', 409) }
}

/** Change an incident's status from the control room. */
async function setStatus(id: string, st: 'assigned' | 'resolved' | 'dismissed', w: Who, team?: string): Promise<APIGatewayProxyResult> {
  const r = await edit(id, (i, now) => ({
    ...i,
    status: st,
    team: st === 'assigned' ? team : i.team,
    asg: st === 'assigned' ? now : i.asg,
    fstate: st === 'assigned' ? undefined : i.fstate,
    fts: st === 'assigned' ? undefined : i.fts,
    res: st === 'resolved' ? now : i.res,
    by: st === 'resolved' ? 'control' : i.by,
    esc: 0, // a state change restarts the overdue clock
  }))
  if ('err' in r) return r.err
  await audit(w, st, id, team)
  return ok(strip(r.inc))
}

const TEAM_STATES = ['enroute', 'arrived', 'done', 'nofind'] as const

/** A field team reports progress on its OWN incident. Only the assigned team can touch it. */
async function progress(id: string, state: string, w: Who): Promise<APIGatewayProxyResult> {
  if (!(TEAM_STATES as readonly string[]).includes(state)) return bad('state must be one of ' + TEAM_STATES.join(', '))
  const r = await edit(id, (i, now) => {
    if (i.status !== 'assigned' || i.team !== w.team) return bad('this incident is not assigned to your team', 403)
    if (state === 'done') return { ...i, status: 'resolved', res: now, by: 'team', fstate: undefined, fts: now, esc: 0 }
    // Nobody found there: hand it back to the queue, flagged for a human, restarting the clock.
    if (state === 'nofind') return { ...i, status: 'open', team: undefined, asg: undefined, fstate: undefined, fts: undefined, opn: now, review: true, esc: 0 }
    return { ...i, fstate: state as 'enroute' | 'arrived', fts: now, esc: 0 }
  })
  if ('err' in r) return r.err
  await audit(w, 'field:' + state, id, w.team)
  return ok(strip(r.inc))
}

async function teams(): Promise<Team[]> {
  const [it, incs] = await Promise.all([q('TEAM', 100), listInc(150)])
  const busy = new Set(incs.filter((i) => i.status === 'assigned').map((i) => i.team))
  return it.map((x) => ({ ...(x.row as Team), busy: busy.has((x.row as Team).id) }))
}

// Which role may call which route. /subscribe is the only public route here.
const ACT: Record<string, Act | 'public'> = {
  'GET /incidents': 'read',
  'GET /gauges': 'read',
  'GET /alerts': 'read',
  'GET /stats': 'read',
  'GET /unplaced': 'read',
  'POST /incidents/{id}/assign': 'dispatch',
  'POST /incidents/{id}/resolve': 'dispatch',
  'POST /incidents/{id}/dismiss': 'dispatch',
  'POST /incidents/{id}/feedback': 'dispatch',
  'GET /teams': 'read',
  'GET /metrics': 'read',
  'GET /feedback': 'admin',
  'POST /field/ping': 'field',
  'GET /field/mine': 'field',
  'POST /field/{id}/progress': 'field',
  'POST /admin/replay': 'admin',
  'GET /audit': 'admin',
  'POST /subscribe': 'public',
}

export const handler = async (e: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const route = `${e.httpMethod} ${e.resource}`
  const b = body(e.body)
  const need = ACT[route]
  const w = whoami(e)
  if (need && need !== 'public' && !can(w, need)) return bad(w ? 'your role may not do this' : 'sign in required', w ? 403 : 401)

  switch (route) {
    case 'GET /incidents': {
      const all = await listInc(150)
      // ?all=1 includes closed incidents, for after-action analysis. Officers only: it exposes the whole history.
      if (e.queryStringParameters?.all === '1') {
        if (!can(w, 'admin')) return bad('your role may not do this', 403)
        return ok({ items: all.map(strip) })
      }
      return ok({ items: all.filter((i) => i.status !== 'resolved' && i.status !== 'dismissed').map(strip) })
    }

    case 'POST /incidents/{id}/assign': {
      const team = typeof b?.team === 'string' ? b.team.trim().slice(0, 40) : ''
      if (!team) return bad('team required')
      return setStatus(e.pathParameters?.id ?? '', 'assigned', w!, team)
    }

    case 'POST /incidents/{id}/resolve':
      return setStatus(e.pathParameters?.id ?? '', 'resolved', w!)

    case 'POST /incidents/{id}/dismiss': // judged false or duplicate by a person; a new independent report re-opens it
      return setStatus(e.pathParameters?.id ?? '', 'dismissed', w!)

    case 'POST /incidents/{id}/feedback': {
      const inc = await getInc(e.pathParameters?.id ?? '')
      if (!inc) return bad('no such incident', 404)
      if (typeof b?.ok !== 'boolean') return bad('ok must be true or false')
      const wrong = (Array.isArray(b.wrong) ? (b.wrong as unknown[]) : []).filter((x): x is Wrong => (WRONGS as unknown[]).includes(x))
      const now = Date.now()
      const row: Fb = { id: rid(), ts: now, actor: w!.name, inc: inc.id, ok: b.ok, wrong: b.ok ? [] : [...new Set(wrong)], place: inc.place, ppl: inc.ppl, needs: inc.needs, sev: inc.sev, texts: inc.snips.map((s) => s.t) }
      await ddb.send(new PutCommand({ TableName: TBL(), Item: { pk: 'FB#' + row.id, sk: 'F', g1p: 'FB', g1s: pad(now / 1000, 12) + row.id, row, ttl: Math.floor(now / 1000) + 400 * 86400 } }))
      await audit(w!, b.ok ? 'feedback:ok' : 'feedback:wrong', inc.id)
      return ok({ ok: true }, 201)
    }

    case 'GET /teams':
      return ok({ items: await teams() })

    case 'POST /field/ping': {
      const lat = Number(b?.lat)
      const lon = Number(b?.lon)
      if (!Number.isFinite(lat) || !Number.isFinite(lon) || !inBihar(lat, lon)) return bad('lat/lon must be inside Bihar')
      const t: Team = { id: w!.team, lat, lon, ts: Date.now() }
      await ddb.send(new PutCommand({ TableName: TBL(), Item: { pk: 'T#' + t.id.toLowerCase(), sk: 'M', g1p: 'TEAM', g1s: t.id, row: t, ttl: Math.floor(Date.now() / 1000) + 12 * 3600 } }))
      return ok({ ok: true })
    }

    case 'GET /field/mine': {
      const mine = (await listInc(150)).filter((i) => i.status === 'assigned' && i.team === w!.team)
      return ok({ team: w!.team, items: mine.map(strip) })
    }

    case 'POST /field/{id}/progress':
      return progress(e.pathParameters?.id ?? '', typeof b?.state === 'string' ? b.state : '', w!)

    case 'GET /metrics': {
      const [incs, fb] = await Promise.all([allInc(), q('FB', 1000, true)])
      return ok(metrics(incs, fb.map((x) => x.row as Fb), Date.now()))
    }

    case 'GET /feedback': {
      const fb = await q('FB', 1000, true)
      return ok({ items: fb.map((x) => x.row as Fb) })
    }

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
      if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) {
        await sns.send(new SubscribeCommand({ TopicArn: env('TOPIC'), Protocol: 'email', Endpoint: em }))
        return ok({ ok: true, note: 'confirm via the email AWS sends you' }, 202)
      }
      return bad('send a valid email address')
    }

    case 'POST /admin/replay': {
      // Redrive everything in the dead-letter queue back to the main queue.
      const r = await sqs.send(new StartMessageMoveTaskCommand({ SourceArn: env('DLQ_ARN'), DestinationArn: env('Q_ARN') }))
      await audit(w!, 'replay', 'dlq')
      return ok({ task: r.TaskHandle }, 202)
    }

    case 'GET /audit': {
      const it = await q('AUDIT', 100, true)
      return ok({ items: it.map((x) => x.row as AuditRow) })
    }

    default:
      return bad('not found', 404)
  }
}
