// Shared Cognito sign-in card used by the control-room dashboard and the field-team page.
import { answer, save, signIn, type Cfg, type Step } from './auth'

export interface Labels {
  login: string
  email: string
  pass: string
  newpass: string
  code: string
  go: string
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (text) e.textContent = text // never innerHTML
  return e
}

/** Shows the card inside `app`. Handles first-login new password and authenticator codes. `extra` adds a button under it. */
export function showLogin(app: HTMLElement, cfg: Cfg, L: Labels, done: () => void, extra?: HTMLElement): void {
  const em = el('input', 'inp')
  em.type = 'email'
  em.autocomplete = 'username'
  const pw = el('input', 'inp')
  pw.type = 'password'
  pw.autocomplete = 'current-password'
  const msg = el('p', 'msg')
  const go = el('button', 'btn go', L.go)
  const labEm = el('label', '', L.email)
  const labPw = el('label', '', L.pass)
  const card = el('div', 'card')
  card.append(el('h2', '', L.login), labEm, em, labPw, pw, msg, go)
  if (extra) card.append(extra)
  const box = el('div', 'modal solid')
  box.append(card)
  app.append(box)

  let step: Step | null = null
  const fin = (s: Step) => {
    if ('done' in s) {
      save(s.done)
      done()
      return
    }
    step = s
    em.remove()
    labEm.remove()
    labPw.textContent = s.challenge === 'NEW_PASSWORD_REQUIRED' ? L.newpass : L.code
    pw.value = ''
    pw.type = s.challenge === 'NEW_PASSWORD_REQUIRED' ? 'password' : 'text'
    pw.autocomplete = s.challenge === 'NEW_PASSWORD_REQUIRED' ? 'new-password' : 'one-time-code'
  }
  go.onclick = async () => {
    msg.textContent = ''
    go.setAttribute('disabled', '')
    try {
      fin(step && 'challenge' in step ? await answer(cfg, step, pw.value.trim()) : await signIn(cfg, em.value.trim(), pw.value))
    } catch (e) {
      msg.textContent = (e as Error).message
    } finally {
      go.removeAttribute('disabled')
    }
  }
  pw.onkeydown = (e) => {
    if (e.key === 'Enter') go.click()
  }
}
