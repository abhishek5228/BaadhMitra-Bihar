import type { APIGatewayProxyEvent } from 'aws-lambda'
import { PutCommand } from '@aws-sdk/lib-dynamodb'
import { TBL, ddb, pad, rid } from './aws'
import type { Role } from '../../shared/types'

export interface Who {
  sub: string
  name: string // email or username, for the audit trail
  team: string // field teams: the display name set on their account (Cognito `name`), else their email
  roles: Role[]
}

const ALL: Role[] = ['district_officer', 'control_room', 'viewer', 'field_team']

/** Cognito puts groups in the verified ID token claims as "[a b]" or "a,b" depending on the gateway. */
export function parseGroups(v: unknown): Role[] {
  const raw = Array.isArray(v) ? v.map(String) : typeof v === 'string' ? v.replace(/[[\]"]/g, '').split(/[\s,]+/) : []
  return ALL.filter((r) => raw.includes(r))
}

/** Identity as verified by the API Gateway Cognito authorizer. Null means "not signed in". */
export function whoami(e: Pick<APIGatewayProxyEvent, 'requestContext'>): Who | null {
  const c = (e.requestContext?.authorizer?.claims ?? null) as Record<string, unknown> | null
  if (!c || typeof c.sub !== 'string') return null
  const name = String(c.email ?? c['cognito:username'] ?? c.sub).slice(0, 80)
  return { sub: c.sub, name, team: String(c.name ?? name).trim().slice(0, 40), roles: parseGroups(c['cognito:groups']) }
}

export type Act = 'read' | 'dispatch' | 'admin' | 'field'
const NEED: Record<Act, Role[]> = {
  read: ['district_officer', 'control_room', 'viewer'],
  dispatch: ['district_officer', 'control_room'], // assign, resolve, dismiss
  admin: ['district_officer'], // replay, audit log, labelled-feedback export
  field: ['field_team'], // a rescue team's own phone: ping, my incidents, progress. Nothing else.
}
export const can = (w: Who | null, a: Act): boolean => !!w && w.roles.some((r) => NEED[a].includes(r))

const ONE_YEAR_PLUS = 400 * 86400

/** Append-only record of who changed what. Items are never updated, only added. */
export async function audit(w: Who, action: string, target: string, team?: string, now = Date.now()): Promise<void> {
  const id = rid()
  await ddb.send(
    new PutCommand({
      TableName: TBL(),
      Item: {
        pk: 'AU#' + id,
        sk: 'A',
        g1p: 'AUDIT',
        g1s: pad(now / 1000, 12) + id,
        row: { id, ts: now, actor: w.name, action, target, team },
        ttl: Math.floor(now / 1000) + ONE_YEAR_PLUS,
      },
    }),
  )
}
