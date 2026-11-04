import './field.css'
import type { Inc, Need } from '../../shared/types'
import { Expired, authed } from './api'
import { clear, load, type Cfg, type Sess } from './auth'
import { showLogin } from './login'

// The rescue crew's own page. Phone first, Hindi first, works on a patchy network:
// progress taps are saved on the phone and sent when the signal returns.

type Lang = 'hi' | 'en'
const D = {
  hi: {
    title: 'बचाव दल', login: 'दल का साइन-इन', email: 'ईमेल', pass: 'पासवर्ड', newpass: 'नया पासवर्ड (12+ अक्षर)', code: '6 अंकों का कोड', go: 'आगे बढ़ें',
    share: '📍 मेरी लोकेशन कंट्रोल रूम को दिखाएँ', stop: 'लोकेशन बंद करें', sharing: 'लोकेशन साझा हो रही है', off: 'लोकेशन बंद है',
    none: 'अभी आपके दल को कोई घटना नहीं सौंपी गई है। यह पेज खुद अपडेट होता है।', nav: '🧭 रास्ता दिखाएँ', enroute: '🚤 निकल पड़े', arrived: '📍 मौके पर पहुँचे',
    done: '✅ बचाव पूरा हुआ', nofind: '❌ कोई नहीं मिला', again: 'पक्का? फिर से दबाएँ', people: 'लोग', needs: 'ज़रूरत', vul: 'बच्चे / बुजुर्ग / बीमार हैं',
    queued: 'नेटवर्क नहीं। आपकी बात फ़ोन में सुरक्षित है, नेटवर्क आते ही चली जाएगी।', sent: 'भेज दिया ✓', signout: 'साइन आउट', wrongrole: 'यह खाता बचाव दल का नहीं है।',
    noteam: 'इस खाते का दल का नाम तय नहीं है, प्रशासक से कहें।', need: { boat: 'नाव', food: 'खाना', water: 'पानी', medical: 'दवा', shelter: 'आश्रय' } as Record<Need, string>,
    st: { enroute: 'रास्ते में', arrived: 'मौके पर' }, sess: 'सत्र समाप्त, फिर से साइन-इन करें।',
  },
  en: {
    title: 'Rescue team', login: 'Team sign-in', email: 'Email', pass: 'Password', newpass: 'New password (12+ characters)', code: '6-digit code', go: 'Continue',
    share: '📍 Show my location to control room', stop: 'Stop sharing', sharing: 'Sharing location', off: 'Location off',
    none: 'No incident is assigned to your team right now. This page updates itself.', nav: '🧭 Navigate', enroute: '🚤 On the way', arrived: '📍 Arrived',
    done: '✅ Rescue complete', nofind: '❌ Nobody found', again: 'Sure? Tap again', people: 'people', needs: 'Needs', vul: 'Children / elderly / sick',
    queued: 'No network. Saved on your phone and will send when the signal returns.', sent: 'Sent ✓', signout: 'Sign out', wrongrole: 'This account is not a rescue team account.',
    noteam: 'This account has no team name set. Ask the administrator.', need: { boat: 'boat', food: 'food', water: 'water', medical: 'medicine', shelter: 'shelter' } as Record<Need, string>,
    st: { enroute: 'On the way', arrived: 'At the spot' }, sess: 'Session ended, please sign in again.',
  },
}

function h(tag: string, cls = '', ...kids: (string | Node | null | false)[]): HTMLElement {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  for (const k of kids) if (k) e.append(k)
  return e
}

// ---- the small outbox for progress taps -------------------------------------------------------
interface Act {
  id: string
  state: string
}
const OB = 'bmfield'
const readOb = (): Act[] => {
  try {
    const v = JSON.parse(localStorage.getItem(OB) ?? '[]') as Act[]
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}
const writeOb = (a: Act[]): void => {
  try {
    localStorage.setItem(OB, JSON.stringify(a.slice(-30)))
  } catch {
    /* storage unavailable: taps still try once, directly */
  }
}

async function main(): Promise<void> {
  const app = document.getElementById('fd') as HTMLElement
  let lang: Lang = navigator.language.startsWith('en') ? 'en' : 'hi'
  let T = D[lang]

  let cfg: Cfg | null = null
  try {
    const c = (await (await fetch('config.json', { cache: 'no-store' })).json()) as Partial<Cfg>
    if (c.api && c.region && c.clientId) cfg = { api: c.api, region: c.region, clientId: c.clientId }
  } catch {
    /* offline first visit */
  }
  if (!cfg) return void app.replaceChildren(h('p', 'none', 'Not configured.'))
  const ss: Sess | null = load()
  if (!ss) return showLogin(document.body, cfg, { login: T.login, email: T.email, pass: T.pass, newpass: T.newpass, code: T.code, go: T.go }, () => location.reload())
  if (!ss.roles.includes('field_team')) {
    app.replaceChildren(h('p', 'none', T.wrongrole))
    return
  }
  const call = authed(cfg, ss)

  let team = ''
  let jobs: Inc[] = []
  let offline = false
  let queuedMsg = false
  let share = false
  let watch = -1
  let lastPing = 0
  let armed = '' // two-tap confirmation for done / nofind
  let sig = ''

  const hdr = h('div', 'fhd')
  const net = h('div', 'net hide')
  const shareRow = h('div', 'share')
  const list = h('div')
  app.replaceChildren(hdr, net, shareRow, list)

  // ---- location sharing: only while the crew chooses, only while this page is open
  const ping = async (lat: number, lon: number) => {
    if (Date.now() - lastPing < 25_000) return
    lastPing = Date.now()
    try {
      await call('POST', '/field/ping', { lat, lon })
    } catch (e) {
      if (e instanceof Expired) return expired()
    }
  }
  const startShare = () => {
    if (!navigator.geolocation) return
    share = true
    watch = navigator.geolocation.watchPosition((p) => void ping(p.coords.latitude, p.coords.longitude), () => undefined, { enableHighAccuracy: true, maximumAge: 15_000, timeout: 20_000 })
    drawShare()
  }
  const stopShare = () => {
    share = false
    if (watch >= 0) navigator.geolocation.clearWatch(watch)
    drawShare()
  }
  function drawShare(): void {
    const b = h('button', 'btn alt', share ? T.stop : T.share)
    b.onclick = () => (share ? stopShare() : startShare())
    shareRow.replaceChildren(h('span', 'dot' + (share ? ' on' : '')), h('small', '', share ? T.sharing : T.off), b)
  }

  function expired(): void {
    clear()
    alert(T.sess)
    location.reload()
  }

  // ---- sending a progress tap, with an outbox for bad networks
  async function send(a: Act): Promise<'ok' | 'drop' | 'retry'> {
    try {
      const r = await call<Inc>('POST', `/field/${encodeURIComponent(a.id)}/progress`, { state: a.state })
      if (r.status >= 200 && r.status < 300) return 'ok'
      return r.status >= 500 ? 'retry' : 'drop' // 403/404/409: no longer ours or already done, retrying cannot help
    } catch (e) {
      if (e instanceof Expired) {
        expired()
        return 'retry'
      }
      return 'retry'
    }
  }
  async function flush(): Promise<void> {
    const q = readOb()
    if (!q.length) return
    const keep: Act[] = []
    for (const a of q) if ((await send(a)) === 'retry') keep.push(a)
    writeOb(keep)
    if (keep.length < q.length) await refresh()
  }
  async function tap(i: Inc, state: string): Promise<void> {
    const a = { id: i.id, state }
    const r = await send(a)
    if (r === 'retry') {
      writeOb([...readOb(), a])
      queuedMsg = true
    } else await refresh()
    draw()
  }

  // ---- drawing
  function drawHdr(): void {
    const out = h('button', 'lang', T.signout)
    out.onclick = () => {
      clear()
      location.reload()
    }
    const lg = h('button', 'lang', lang === 'hi' ? 'EN' : 'हिं')
    lg.onclick = () => {
      lang = lang === 'hi' ? 'en' : 'hi'
      T = D[lang]
      document.documentElement.lang = lang
      sig = ''
      drawHdr()
      drawShare()
      draw()
    }
    hdr.replaceChildren(h('div', '', h('h1', '', T.title + (team ? ' · ' + team : '')), h('small', '', ss ? ss.email : '')), h('div', 'share', lg, out))
  }

  function draw(): void {
    const pending = readOb().length
    net.classList.toggle('hide', !(offline || pending || queuedMsg))
    net.textContent = pending || queuedMsg ? T.queued : '⚠ ' + (lang === 'hi' ? 'नेटवर्क नहीं' : 'No network')
    const key = JSON.stringify([lang, armed, jobs.map((j) => [j.id, j.fstate, j.ppl, j.snips.length])])
    if (key === sig) return
    sig = key
    if (!jobs.length) return void list.replaceChildren(h('p', 'none', T.none))
    list.replaceChildren(...jobs.map(card))
  }

  function card(i: Inc): HTMLElement {
    const btn = (label: string, cls: string, fn: () => void) => {
      const b = h('button', 'btn ' + cls, label)
      b.onclick = fn
      return b
    }
    const confirmable = (state: 'done' | 'nofind', label: string, cls: string) =>
      btn(armed === i.id + state ? T.again : label, cls + (armed === i.id + state ? ' armed' : ''), () => {
        if (armed === i.id + state) {
          armed = ''
          void tap(i, state)
        } else {
          armed = i.id + state
          draw()
          setTimeout(() => {
            if (armed === i.id + state) {
              armed = ''
              draw()
            }
          }, 5000)
        }
      })
    const nav = h('a', 'btn alt', T.nav) as HTMLAnchorElement
    nav.href = `https://www.google.com/maps/dir/?api=1&destination=${i.lat},${i.lon}`
    nav.target = '_blank'
    nav.rel = 'noopener'
    return h(
      'section',
      'job',
      h('h2', '', i.place),
      h('div', 'meta', `${i.ppl ? i.ppl + ' ' + T.people + ' · ' : ''}${i.needs.length ? T.needs + ': ' + i.needs.map((n) => T.need[n]).join(', ') : ''}${i.fstate ? ' · ' + T.st[i.fstate] : ''}`),
      i.vul ? h('div', 'sos', '⚠ ' + T.vul) : null,
      ...i.snips.slice(-2).map((s) => h('blockquote', '', s.t)), // textContent only: reports are untrusted text
      h('div', 'acts', nav, btn(T.enroute, '', () => void tap(i, 'enroute')), btn(T.arrived, '', () => void tap(i, 'arrived')), confirmable('done', T.done, 'go'), confirmable('nofind', T.nofind, 'dng')),
    )
  }

  async function refresh(): Promise<void> {
    try {
      const r = await call<{ team: string; items: Inc[] }>('GET', '/field/mine')
      offline = false
      if (r.data) {
        team = r.data.team
        jobs = r.data.items
      } else if (r.status === 403) {
        app.replaceChildren(h('p', 'none', T.wrongrole))
        return
      }
      if (!readOb().length) queuedMsg = false
    } catch (e) {
      if (e instanceof Expired) return expired()
      offline = true
    }
    drawHdr()
    draw()
  }

  drawHdr()
  drawShare()
  await refresh()
  if (!team) app.append(h('p', 'none', T.noteam))
  setInterval(() => void flush().then(refresh), 12_000)
  addEventListener('online', () => void flush().then(refresh))
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && void refresh())
}

void main()
