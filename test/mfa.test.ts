import { afterEach, describe, expect, it, vi } from 'vitest'
import { chunk, mfaConfirm, mfaStart, otpauth, type Cfg, type Sess } from '../web/src/auth'

const cfg: Cfg = { api: 'https://x/prod/', region: 'ap-southeast-2', clientId: 'cid' }
const sess = (o: Partial<Sess> = {}): Sess => ({ id: 'i', acc: 'ACCESS', refresh: 'r', exp: Date.now() + 3600_000, email: 'a@b.in', roles: ['control_room'], ...o })

function fake(replies: Record<string, unknown>): string[] {
  const seen: string[] = []
  vi.stubGlobal('fetch', async (_u: string, init: { headers: Record<string, string>; body: string }) => {
    const t = init.headers['x-amz-target'].split('.')[1]
    seen.push(t + ' ' + init.body)
    return { ok: true, json: async () => replies[t] ?? {} }
  })
  return seen
}
afterEach(() => vi.unstubAllGlobals())

describe('two-step sign-in enrolment', () => {
  it('builds an otpauth address and a readable key', () => {
    expect(otpauth('a@b.in', 'ABCD EFGH')).toBe('otpauth://totp/BaadhMitra:a%40b.in?secret=ABCD%20EFGH&issuer=BaadhMitra')
    expect(chunk('ABCDEFGHIJ')).toBe('ABCD EFGH IJ')
  })
  it('asks Cognito for a secret using the access token', async () => {
    const seen = fake({ AssociateSoftwareToken: { SecretCode: 'SECRET123' } })
    const r = await mfaStart(cfg, sess())
    expect(r.secret).toBe('SECRET123')
    expect(r.uri).toContain('secret=SECRET123')
    expect(seen[0]).toContain('"AccessToken":"ACCESS"')
  })
  it('turns two-step on only after the code is verified', async () => {
    const seen = fake({ VerifySoftwareToken: { Status: 'SUCCESS' } })
    await mfaConfirm(cfg, sess(), '123 456')
    expect(seen.map((x) => x.split(' ')[0])).toEqual(['VerifySoftwareToken', 'SetUserMFAPreference'])
    expect(seen[0]).toContain('"UserCode":"123456"')
  })
  it('does not switch it on when the code is wrong', async () => {
    const seen = fake({ VerifySoftwareToken: { Status: 'ERROR' } })
    await expect(mfaConfirm(cfg, sess(), '000000')).rejects.toThrow()
    expect(seen).toHaveLength(1)
  })
  it('asks for a fresh sign-in when the session has no access token', async () => {
    fake({})
    await expect(mfaStart(cfg, sess({ acc: undefined }))).rejects.toThrow(/sign in again/)
  })
})
