// Cognito sign-in over the plain Cognito Identity Provider HTTP API (no SDK, so the bundle stays small).
// Tokens live in sessionStorage: closing the tab signs out, which suits shared control-room PCs.
import type { Role } from '../../shared/types'

export interface Cfg {
  api: string
  region: string
  clientId: string
}
export interface Sess {
  id: string // ID token (sent to API Gateway)
  refresh: string
  exp: number // ms
  email: string
  roles: Role[]
}

const K = 'bmsess'
const ROLES: Role[] = ['district_officer', 'control_room', 'viewer', 'field_team']

type Res = {
  AuthenticationResult?: { IdToken: string; RefreshToken?: string; ExpiresIn: number }
  ChallengeName?: string
  Session?: string
  message?: string
  __type?: string
}
export type Step = { done: Sess } | { challenge: 'NEW_PASSWORD_REQUIRED' | 'SOFTWARE_TOKEN_MFA'; session: string; user: string }

async function idp(cfg: Cfg, target: string, body: unknown): Promise<Res> {
  const r = await fetch(`https://cognito-idp.${cfg.region}.amazonaws.com/`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-amz-json-1.1', 'x-amz-target': 'AWSCognitoIdentityProviderService.' + target },
    body: JSON.stringify(body),
  })
  const js = (await r.json().catch(() => ({}))) as Res
  if (!r.ok) throw new Error(js.message ?? js.__type ?? 'sign-in failed')
  return js
}

/** Decode the payload of a JWT that Cognito just handed us over TLS. API Gateway does the real verification. */
export function claims(jwt: string): Record<string, unknown> {
  try {
    const p = jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    return JSON.parse(decodeURIComponent(escape(atob(p)))) as Record<string, unknown>
  } catch {
    return {}
  }
}

function sess(res: NonNullable<Res['AuthenticationResult']>, old?: Sess): Sess {
  const c = claims(res.IdToken)
  const g = c['cognito:groups']
  const roles = ROLES.filter((r) => Array.isArray(g) && g.includes(r))
  return { id: res.IdToken, refresh: res.RefreshToken ?? old?.refresh ?? '', exp: Date.now() + res.ExpiresIn * 1000, email: String(c.email ?? c['cognito:username'] ?? ''), roles }
}

function next(res: Res, user: string): Step {
  if (res.AuthenticationResult) return { done: sess(res.AuthenticationResult) }
  if (res.ChallengeName === 'NEW_PASSWORD_REQUIRED' || res.ChallengeName === 'SOFTWARE_TOKEN_MFA') return { challenge: res.ChallengeName, session: res.Session ?? '', user }
  throw new Error('This account needs a sign-in step this page does not support: ' + (res.ChallengeName ?? 'unknown'))
}

export async function signIn(cfg: Cfg, user: string, pass: string): Promise<Step> {
  return next(await idp(cfg, 'InitiateAuth', { AuthFlow: 'USER_PASSWORD_AUTH', ClientId: cfg.clientId, AuthParameters: { USERNAME: user, PASSWORD: pass } }), user)
}

/** Answer a challenge: a new password (first login) or a 6-digit authenticator code. */
export async function answer(cfg: Cfg, s: Extract<Step, { challenge: string }>, value: string): Promise<Step> {
  const rsp = s.challenge === 'NEW_PASSWORD_REQUIRED' ? { USERNAME: s.user, NEW_PASSWORD: value } : { USERNAME: s.user, SOFTWARE_TOKEN_MFA_CODE: value }
  return next(await idp(cfg, 'RespondToAuthChallenge', { ChallengeName: s.challenge, ClientId: cfg.clientId, Session: s.session, ChallengeResponses: rsp }), s.user)
}

export function save(s: Sess): void {
  try {
    sessionStorage.setItem(K, JSON.stringify(s))
  } catch {
    /* private mode: session lasts for this page load */
  }
}
export function load(): Sess | null {
  try {
    const v = JSON.parse(sessionStorage.getItem(K) ?? 'null') as Sess | null
    return v && typeof v.id === 'string' ? v : null
  } catch {
    return null
  }
}
export function clear(): void {
  try {
    sessionStorage.removeItem(K)
  } catch {
    /* nothing to clear */
  }
}

/** A valid ID token, refreshing it a minute before expiry. Returns null when the session is over. */
export async function token(cfg: Cfg, s: Sess): Promise<string | null> {
  if (Date.now() < s.exp - 60_000) return s.id
  if (!s.refresh) return null
  try {
    const r = await idp(cfg, 'InitiateAuth', { AuthFlow: 'REFRESH_TOKEN_AUTH', ClientId: cfg.clientId, AuthParameters: { REFRESH_TOKEN: s.refresh } })
    if (!r.AuthenticationResult) return null
    Object.assign(s, sess(r.AuthenticationResult, s))
    save(s)
    return s.id
  } catch {
    return null
  }
}
