import './style.css'
import type { Alert, Gauge, Inc, Need, Team, Wrong } from '../../shared/types'
import { WRONGS } from '../../shared/types'
import { attention, type Issue } from '../../shared/attention'
import { sla } from '../../shared/sla'
import { filt, type Mode } from './filter'
import { toCsv } from './csv'
import { suggest } from '../../shared/suggest'
import { hoursToDanger } from '../../shared/trend'
import { chunk } from './auth'
import { inBihar } from '../../shared/geo'
import { connect, Expired, type Api, type Pin, type St } from './api'
import type { Cfg } from './auth'
import { showLogin } from './login'
import { dict, type Lang } from './i18n'
import { World, urg } from './scene'

// Tiny DOM helper. Everything user-supplied goes through textContent, never innerHTML.
type K = string | Node | null | undefined | false
function h(tag: string, cls = '', ...kids: (K | HTMLElement)[]): HTMLElement {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  for (const k of kids) if (k) e.append(k)
  return e
}
const put = (el: HTMLElement, ...k: K[]) => el.replaceChildren(...(k.filter(Boolean) as (string | Node)[]))
// Redraw a region only when what it shows has changed. Rebuilding the DOM every poll would
// swallow clicks that land between mousedown and mouseup, and would reset scroll and focus.
const sigs: Record<string, string> = {}
const changed = (name: string, key: unknown): boolean => {
  const k = JSON.stringify(key)
  if (sigs[name] === k) return false
  sigs[name] = k
  return true
}
const col = (s: number) => '#' + urg(s).getHexString()
const ago = (ts: number) => {
  const m = Math.max(0, Math.round((Date.now() - ts) / 60000))
  return m < 1 ? 'now' : m < 90 ? `${m}m` : `${Math.round(m / 60)}h`
}
const TEAMS = ['NDRF Team A', 'SDRF Boat 2', 'Local fishermen boats', 'Army flood column']

async function main(): Promise<void> {
  const boot = await connect()
  const { api } = boot
  const isDemo = api.mode === 'demo'
  let lang: Lang = navigator.language.startsWith('hi') ? 'hi' : 'en'
  let T = dict(lang)
  let incs: Inc[] = []
  let gs: Gauge[] = []
  let als: Alert[] = []
  let tms: Team[] = []
  let st: St = { reports: 0, incidents: 0, rule: 0, review: 0, dedup: 0, unpl: 0 }
  let sel = ''
  let qtxt = ''
  let mode: Mode = 'all'
  let pin: Pin | undefined
  const seen = new Set<string>()
  let first = true

  const app = document.getElementById('app') as HTMLElement
  const stage = h('div', 'stage')
  const top = h('header', 'top')
  const left = h('aside', 'panel left')
  const right = h('aside', 'panel right hide')
  const comp = h('section', 'panel comp')
  const bar = h('section', 'gbar')
  const toast = h('div', 'toast hide')
  toast.setAttribute('role', 'status') // read out by screen readers when a message appears
  app.append(stage, top, left, right, comp, bar, toast)
  // The header wraps onto a second row on narrower screens or with more buttons. Panels below it follow its real height,
  // otherwise they cover the buttons (found by the browser tests).
  const fit = (): void => document.documentElement.style.setProperty('--tb', `${Math.ceil(top.getBoundingClientRect().bottom)}px`)
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(fit).observe(top)
  fit()

  const world = new World(stage, (id) => pickInc(id))

  const say = (m: string, bad = false) => {
    toast.replaceChildren(h('span', '', m))
    toast.className = 'toast' + (bad ? ' bad' : '')
    setTimeout(() => toast.classList.add('hide'), 6000)
  }

  // ------------------------------------------------------------------ header
  function drawTop(): void {
    const late = incs.filter((i) => sla(i, Date.now()).lvl === 2).length
    if (!changed('top', [lang, st, incs.length, api.mode, api.who, late])) return
    const mode = h('span', 'mode ' + api.mode, api.mode === 'live' ? T.live : T.demo)
    const mk = (label: string, fn: () => void) => {
      const b = h('button', 'btn', label)
      b.onclick = fn
      return b
    }
    const stat = (v: string, l: string) => h('div', 'stat', h('b', '', v), h('span', '', l))
    const kids: K[] = [
      h('div', 'brand', h('div', 'logo', '🌊'), h('div', '', h('h1', '', T.title), h('p', '', T.sub))),
      h('div', 'stats', stat(String(st.reports), T.stats.reports), stat(String(incs.length), T.stats.inc), stat(Math.round(st.dedup * 100) + '%', T.stats.dedup), stat(String(st.rule), T.stats.rule), st.unpl ? stat(String(st.unpl), T.stats.unpl) : null, late ? stat(String(late), '⏰ ' + T.over) : null),
      h('div', 'acts', mode),
    ]
    const acts = kids[2] as HTMLElement
    if (api.surge) acts.append(mk('⚡ ' + T.surge, () => api.surge?.()))
    if (boot.cfg && isDemo) acts.append(mk('🔑 ' + T.login, () => (location.href = location.pathname)))
    acts.append(mk('📊 ' + T.report, openReport))
    if (can('admin')) acts.append(mk('🧾 ' + T.audit, openAudit))
    if (api.mfa) acts.append(mk('🔐 ' + T.mfa, openMfa))
    if (api.who) acts.append(h('span', 'who', api.who + (api.roles.length ? '' : ' ⚠')))
    if (api.signOut) acts.append(mk(T.signout, () => api.signOut?.()))
    acts.append(mk(lang === 'en' ? 'हिं' : 'EN', () => setLang(lang === 'en' ? 'hi' : 'en')))
    top.replaceChildren(...(kids as Node[]))
  }

  // ------------------------------------------------------------------ roles
  // The server enforces these. Hiding a button is only a courtesy; it is never the protection.
  const can = (a: 'read' | 'dispatch' | 'admin'): boolean =>
    isDemo ? true : a === 'read' ? api.roles.some((r) => r !== 'field_team') : a === 'dispatch' ? api.roles.some((r) => r === 'control_room' || r === 'district_officer') : api.roles.includes('district_officer')

  // A modal must be reachable and leavable without a mouse: label it, move focus in, close on Escape or a click outside.
  function wire(box: HTMLElement, x: HTMLElement): void {
    box.setAttribute('role', 'dialog')
    box.setAttribute('aria-modal', 'true')
    x.setAttribute('aria-label', 'close')
    const esc = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') x.click()
    }
    document.addEventListener('keydown', esc)
    const gone = new MutationObserver(() => {
      if (!box.isConnected) {
        document.removeEventListener('keydown', esc)
        gone.disconnect()
      }
    })
    gone.observe(app, { childList: true })
    box.addEventListener('click', (e) => {
      if (e.target === box) x.click()
    })
    queueMicrotask(() => x.focus())
  }

  async function openMfa(): Promise<void> {
    const m = api.mfa
    if (!m) return
    try {
      const { secret, uri } = await m.start()
      const box = h('div', 'modal')
      const x = h('button', 'btn ghost close', '✕')
      x.onclick = () => box.remove()
      const code = h('input', 'find') as HTMLInputElement
      code.inputMode = 'numeric'
      code.autocomplete = 'one-time-code'
      code.maxLength = 7
      code.setAttribute('aria-label', T.mfaCode)
      code.placeholder = T.mfaCode
      const go = h('button', 'btn', T.mfaOn)
      const msg = h('p', 'mu')
      go.onclick = async () => {
        try {
          await m.confirm(code.value)
          msg.textContent = T.mfaDone
          go.remove()
          code.remove()
        } catch {
          msg.textContent = T.mfaFail
        }
      }
      const link = h('a', '', T.mfaOpen) as HTMLAnchorElement
      link.href = uri
      box.append(h('div', 'card', x, h('h2', '', T.mfa), h('p', 'mu', T.mfaWhy), h('p', '', T.mfaKey), h('code', 'key', chunk(secret)), link, code, go, msg))
      app.append(box)
      wire(box, x)
    } catch {
      say(T.err, true)
    }
  }

  async function openAudit(): Promise<void> {
    try {
      const rows = await api.audit()
      const box = h('div', 'modal')
      const x = h('button', 'btn ghost close', '✕')
      x.onclick = () => box.remove()
      const tb = h('table', 'tbl', h('tr', '', h('th', '', T.when), h('th', '', T.whoDid), h('th', '', T.what), h('th', '', '#')))
      for (const r of rows) tb.append(h('tr', '', h('td', '', new Date(r.ts).toLocaleString()), h('td', '', r.actor), h('td', '', r.action + (r.team ? ` → ${r.team}` : '')), h('td', '', r.target)))
      box.append(h('div', 'card', x, h('h2', '', T.audit), rows.length ? tb : h('p', 'empty', T.none2)))
      app.append(box)
      wire(box, x)
    } catch {
      say(T.err, true)
    }
  }

  // ------------------------------------------------------------------ queue
  // Built once so typing is never interrupted by the 20-second refresh.
  const qin = h('input', 'find') as HTMLInputElement
  qin.type = 'search'
  qin.setAttribute('aria-label', 'search')
  qin.oninput = () => {
    qtxt = qin.value
    drawQueue()
    qin.focus()
  }
  const tabs: [Mode, HTMLElement][] = (['all', 'late', 'free'] as Mode[]).map((m) => {
    const b = h('button', 'chip tab' + (m === 'all' ? ' on' : ''), m)
    b.onclick = () => {
      mode = m
      for (const [k, x] of tabs) x.classList.toggle('on', k === m)
      drawQueue()
    }
    return [m, b] as [Mode, HTMLElement]
  })
  const qbar = h('div', 'qbar', qin, h('div', 'tabs', ...tabs.map(([, b]) => b)))
  function attn(iss: Issue[]): HTMLElement {
    const box = h('div', 'attn', h('h3', '', `${T.attn.title}${iss.length ? ` (${iss.length})` : ''}`))
    box.setAttribute('aria-live', 'polite')
    if (!iss.length) box.append(h('p', 'empty', '✓ ' + T.attn.none))
    for (const x of iss) {
      const txt = `${x.n} ${T.attn[x.kind]}${x.hrs !== undefined ? ` ${T.attn.within} ${x.hrs} ${T.attn.h}` : ''}`
      const b = h('button', 'att l' + x.lvl, h('span', '', x.lvl === 2 ? '🔴' : '🟡'), h('span', '', txt))
      if (x.ref) b.onclick = () => pickInc(x.ref as string)
      else (b as HTMLButtonElement).disabled = true
      box.append(b)
    }
    return box
  }

  function drawQueue(): void {
    const iss = attention({ incs, gauges: gs, teams: tms, unplaced: st.unpl, now: Date.now() })
    if (!changed('q', [lang, sel, qtxt, mode, iss, als.map((a) => a.id), incs.map((i) => [i.id, i.score, i.n, i.ppl, i.status, i.review, ago(i.last), sla(i, Date.now()).lvl, Math.floor(sla(i, Date.now()).mins / 5)])])) return
    const keep = left.querySelector('.list')?.scrollTop ?? 0 // a refresh must not yank the list back to the top
    const list = h('div', 'list')
    const shown = filt(incs, qtxt, mode, Date.now())
    if (!incs.length) list.append(h('p', 'empty', T.none))
    else if (!shown.length) list.append(h('p', 'empty', T.noMatch))
    for (const i of shown) {
      const row = h(
        'button',
        'row' + (i.id === sel ? ' on' : ''),
        h('span', 'sc', String(i.score)),
        h('span', 'rb', h('b', '', i.place), h('small', '', `${i.n} ${T.reporters} · ${ago(i.last)}${i.ppl ? ` · ${i.ppl} ${T.people}` : ''}`)),
        slaChip(i),
        i.status === 'assigned' ? h('em', 'chip blue', i.fstate ? T.fstate[i.fstate] : T.assigned) : i.review ? h('em', 'chip warn', '?') : null,
      )
      ;(row.firstChild as HTMLElement).style.background = col(i.score)
      row.onclick = () => pickInc(i.id)
      list.append(row)
    }
    const gl = h('div', 'alist')
    for (const a of als.slice(0, 4)) {
      const b = h('div', 'al ' + a.state, h('b', '', a.name), h('p', '', lang === 'hi' ? a.hi : a.en))
      const s = h('button', 'btn mini', '🔊 ' + T.speak)
      s.onclick = () => speak(a)
      b.append(s)
      gl.append(b)
    }
    const had = document.activeElement === qin
    qin.placeholder = T.find
    for (const [m, b] of tabs) b.textContent = { all: T.fAll, late: T.fLate, free: T.fFree }[m]
    put(left, h('h2', '', T.queue), attn(iss), qbar, list, als.length ? h('h2', '', T.alerts) : null, als.length ? gl : null)
    list.scrollTop = keep
    if (had) qin.focus()
  }

  function slaChip(i: Inc): HTMLElement | null {
    const s = sla(i, Date.now())
    if (!s.lvl || !s.why) return null
    const e = h('em', 'chip ' + (s.lvl === 2 ? 'late' : 'warn'), `⏰ ${s.mins}m`)
    e.title = `${T.sla[s.why]}: ${s.mins} ${T.mins}`
    return e
  }

  function speak(a: Alert): void {
    if (a.audio) {
      void new Audio(a.audio).play().catch(() => say(T.err, true))
      return
    }
    if (!('speechSynthesis' in window)) return
    const u = new SpeechSynthesisUtterance(a.hi)
    u.lang = 'hi-IN'
    speechSynthesis.cancel()
    speechSynthesis.speak(u)
  }

  // ------------------------------------------------------------------ detail
  function pickInc(id: string): void {
    sel = id
    world.select(id)
    drawQueue()
    drawRight(true)
  }

  function drawRight(force = false): void {
    const i = incs.find((x) => x.id === sel)
    if (!i) {
      right.className = 'panel right hide'
      right.dataset.id = ''
      sigs.r = ''
      return
    }
    // Do not rebuild while the dispatcher is using the team dropdown on this same incident.
    if (!changed('r', [lang, i])) return
    if (!force && right.dataset.id === sel && right.contains(document.activeElement) && document.activeElement !== document.body) return
    right.dataset.id = sel
    right.className = 'panel right'
    const need = (n: Need) => h('span', 'chip', T.need[n])
    const fld = (l: string, v: K) => h('div', 'fld', h('span', '', l), h('b', '', v))
    const cf = h('div', 'meter', h('i', ''))
    ;(cf.firstChild as HTMLElement).style.width = Math.round(i.conf * 100) + '%'
    const x = h('button', 'btn ghost close', '✕')
    x.onclick = () => {
      sel = ''
      drawRight()
      drawQueue()
    }
    const team = h('select', 'sel') as HTMLSelectElement
    const roster = tms.length ? tms : TEAMS.map((id) => ({ id, busy: false }) as Team)
    for (const t of roster) team.append(new Option(t.id + (t.busy ? ' · ' + T.assigned : ''), t.id))
    const go = h('button', 'btn go', '🚤 ' + T.assign)
    // Nearest crews by straight-line distance. A hint only: the dispatcher still chooses.
    const sg = suggest(i, tms, Date.now())
    const hints = sg.length
      ? h(
          'div',
          'sugg',
          h('small', 'mu', T.sugg),
          ...sg.map((x) => {
            const b = h('button', 'chip tab', `${x.id} · ${x.km} km · ~${x.eta} min${x.busy ? ' · ' + T.assigned : ''}${x.stale ? ' ⚠' : ''}`)
            if (x.stale) b.title = T.sgOld
            b.onclick = () => {
              team.value = x.id
            }
            return b
          }),
        )
      : null
    go.onclick = async () => {
      try {
        await api.assign(i.id, team.value)
        say(`${T.ok}: ${team.value}`)
        await refresh()
      } catch {
        say(T.err, true)
      }
    }
    const done = h('button', 'btn ghost', '✓ ' + T.resolve)
    done.onclick = async () => {
      try {
        await api.resolve(i.id)
        sel = ''
        await refresh()
      } catch {
        say(T.err, true)
      }
    }
    const dis = h('button', 'btn ghost', '🚫 ' + T.dismiss)
    dis.onclick = async () => {
      try {
        await api.dismiss(i.id)
        sel = ''
        await refresh()
      } catch {
        say(T.err, true)
      }
    }
    const fb = feedbackBox(i)
    const sn = h('div', 'snips')
    for (const s of [...i.snips].reverse()) sn.append(h('blockquote', '', h('p', '', s.t), h('small', '', `${ago(s.ts)} · ${s.src === 'llm' ? 'AI' : 'rules'} · ${Math.round(s.conf * 100)}%`)))
    const score = h('div', 'big', String(i.score))
    score.style.color = col(i.score)
    put(
      right,
      x,
      h('div', 'hd', score, h('div', '', h('h2', '', i.place), h('small', '', i.status === 'assigned' ? `${T.assigned}: ${i.team ?? ''}` : T.open))),
      fld(T.reports, `${i.n} ${T.reporters} (${i.raw})`),
      fld(T.people, i.ppl ? String(i.ppl) : '—'),
      i.vul ? h('div', 'flag', '⚠ ' + T.vul) : null,
      h('div', 'fld', h('span', '', T.needs), h('div', 'chips', ...(i.needs.length ? i.needs.map(need) : [h('b', '', '—')]))),
      h('div', 'fld col', h('span', '', `${T.conf}: ${Math.round(i.conf * 100)}%`), cf),
      i.review ? h('div', 'flag amber', '👁 ' + T.review) : null,
      i.fstate ? h('div', 'flag blue', '🚤 ' + T.fstate[i.fstate]) : null,
      (() => { const s = sla(i, Date.now()); return s.lvl && s.why ? h('div', 'flag ' + (s.lvl === 2 ? 'late' : 'amber'), `⏰ ${T.sla[s.why]}: ${s.mins} ${T.mins}`) : null })(),
      h('h3', '', T.msgs),
      sn,
      can('dispatch') ? fb : null,
      i.status === 'resolved' ? null : can('dispatch') ? h('div', 'dispatch', hints, team, go, done, dis) : h('div', 'flag', T.readonly),
    )
  }

  /** The dispatcher's verdict on what the system read. This is what turns the pilot into a measured accuracy. */
  function feedbackBox(i: Inc): HTMLElement {
    const box = h('div', 'fbk', h('b', '', T.fbq))
    const done = (m: string) => put(box, h('small', '', m))
    const row = h('div', 'crow')
    const yes = h('button', 'btn ghost', '✔ ' + T.fbok)
    const no = h('button', 'btn ghost', '✖ ' + T.fbno)
    const picks = new Set<Wrong>()
    const chips = h('div', 'chips hide')
    for (const w of WRONGS) {
      const c = h('button', 'chip', T.wrong[w])
      c.onclick = () => {
        picks.has(w) ? picks.delete(w) : picks.add(w)
        c.classList.toggle('on', picks.has(w))
      }
      chips.append(c)
    }
    const send = h('button', 'btn go hide', T.fbsend)
    const submit = async (ok: boolean) => {
      try {
        await api.feedback(i.id, ok, [...picks])
        done(T.fbthx)
      } catch {
        say(T.err, true)
      }
    }
    yes.onclick = () => void submit(true)
    no.onclick = () => {
      chips.classList.remove('hide')
      send.classList.remove('hide')
    }
    send.onclick = () => void submit(false)
    row.append(yes, no)
    box.append(row, chips, send)
    return box
  }

  // ------------------------------------------------------------------ response-time report
  async function openReport(): Promise<void> {
    try {
      const m = await api.metrics()
      const box = h('div', 'modal')
      const x = h('button', 'btn ghost close', '✕')
      x.onclick = () => box.remove()
      const pc = (p: { n: number; p50: number | null; p90: number | null }) => (p.n ? `${p.p50} / ${p.p90} ${T.mins} (n=${p.n})` : '—')
      const row = (k: string, v: string) => h('tr', '', h('td', '', k), h('td', '', v))
      const tb = h('table', 'tbl')
      tb.append(
        row(T.rcount, `${m.incidents} · ${T.open} ${m.open} · ${T.assigned} ${m.assigned} · ✓ ${m.resolved}`),
        row('⏰ ' + T.over, String(m.overdue)),
        row(T.rassign + ' (p50 / p90)', pc(m.toAssign)),
        row(T.rresolve + ' (p50 / p90)', pc(m.toResolve)),
        row(T.closedBy.team + ' / ' + T.closedBy.control, `${m.teamClosed} / ${m.controlClosed}`),
        row(T.rfb, m.fb.n ? `${Math.round((m.fb.rate ?? 0) * 100)}% (n=${m.fb.n})` : '—'),
        ...WRONGS.filter((w) => m.fb.wrong[w]).map((w) => row('  ✖ ' + T.wrong[w], String(m.fb.wrong[w]))),
      )
      const card = h('div', 'card', x, h('h2', '', T.rtitle), tb, h('small', 'mu', T.rnote))
      const cs = h('button', 'btn', '⬇ ' + T.cexport)
      cs.onclick = async () => {
        // Officers get the whole history including closed incidents, which after-action analysis needs.
        const rows = can('admin') ? await api.incidents(true).catch(() => incs) : incs
        const a = document.createElement('a')
        a.href = URL.createObjectURL(new Blob([toCsv(rows, Date.now())], { type: 'text/csv' }))
        a.download = 'baadhmitra-incidents.csv'
        a.click()
        URL.revokeObjectURL(a.href)
      }
      card.append(cs)
      if (can('admin')) {
        const dl = h('button', 'btn', '⬇ ' + T.rexport)
        dl.onclick = async () => {
          try {
            const rows = await api.fbExport()
            const a = document.createElement('a')
            a.href = URL.createObjectURL(new Blob([JSON.stringify(rows, null, 2)], { type: 'application/json' }))
            a.download = 'baadhmitra-feedback.json'
            a.click()
            URL.revokeObjectURL(a.href)
          } catch {
            say(T.err, true)
          }
        }
        card.append(dl)
      }
      box.append(card)
      app.append(box)
      wire(box, x)
    } catch {
      say(T.err, true)
    }
  }

  // ------------------------------------------------------------------ composer
  function drawComp(): void {
    const ta = h('textarea', 'ta') as HTMLTextAreaElement
    ta.placeholder = T.ph
    ta.maxLength = 1000
    ta.rows = 3
    const send = h('button', 'btn go', '📨 ' + T.send)
    send.onclick = async () => {
      const t = ta.value.trim()
      if (t.length < 3) return
      send.setAttribute('disabled', '')
      try {
        await api.report(t, pin)
        ta.value = ''
        say(T.sent)
        setTimeout(refresh, api.mode === 'demo' ? 0 : 2500)
      } catch {
        say(T.err, true)
      } finally {
        send.removeAttribute('disabled')
      }
    }
    const loc = h('button', 'btn' + (pin ? ' on' : ''), '📍 ' + T.loc)
    loc.onclick = () =>
      navigator.geolocation?.getCurrentPosition(
        (p) => {
          if (inBihar(p.coords.latitude, p.coords.longitude)) {
            pin = { lat: p.coords.latitude, lon: p.coords.longitude }
            loc.classList.add('on')
          } else say('Location is outside Bihar, so it was ignored.', true)
        },
        () => say(T.err, true),
        { enableHighAccuracy: true, timeout: 8000 },
      )
    const rec = h('button', 'btn', '🎙 ' + T.rec)
    let mr: MediaRecorder | null = null
    rec.onclick = async () => {
      if (mr) {
        mr.stop()
        return
      }
      try {
        const ms = await navigator.mediaDevices.getUserMedia({ audio: true })
        const mime = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4'
        const chunks: Blob[] = []
        mr = new MediaRecorder(ms, { mimeType: mime })
        mr.ondataavailable = (e) => chunks.push(e.data)
        mr.onstop = async () => {
          ms.getTracks().forEach((t) => t.stop())
          rec.textContent = '🎙 ' + T.rec
          rec.classList.remove('on')
          mr = null
          try {
            await api.voice(new Blob(chunks, { type: mime }), mime === 'audio/webm' ? 'webm' : 'm4a', pin)
            say(T.sent)
          } catch (e) {
            say((e as Error).message || T.err, true)
          }
        }
        mr.start()
        rec.textContent = '■ ' + T.stop
        rec.classList.add('on')
      } catch {
        say(T.err, true)
      }
    }
    comp.replaceChildren(h('h2', '', T.reports), ta, h('div', 'crow', send, rec, loc))
  }

  // ------------------------------------------------------------------ gauges
  function drawGauges(): void {
    if (!changed('g', [lang, gs.map((g) => [g.id, g.lvl, g.state, g.trend, g.stale])])) return
    bar.replaceChildren(
      ...gs.map((g) => {
        const c = h('div', 'g ' + g.state + (g.stale ? ' stale' : ''), h('b', '', g.name), h('span', '', `${g.lvl.toFixed(2)} m`), h('small', '', `${T.state[g.state]} · ${g.trend >= 0 ? '▲' : '▼'}${Math.abs(g.trend).toFixed(2)}`))
        const eta = hoursToDanger(g)
        if (eta !== null) c.append(h('small', 'eta', `⏱ ~${eta} h ${T.toDanger}`))
        if (g.sim) c.title = T.sim
        if (g.stale) c.title = T.stale
        return c
      }),
    )
  }

  function setLang(l: Lang): void {
    lang = l
    T = dict(l)
    document.documentElement.lang = l
    drawTop()
    drawQueue()
    drawRight()
    drawComp()
    drawGauges()
  }

  // ------------------------------------------------------------------ data loop
  async function refresh(): Promise<void> {
    try {
      ;[incs, gs, als, st, tms] = await Promise.all([api.incidents(), api.gauges(), api.alerts(), api.stats(), api.teams().catch(() => [] as Team[])])
    } catch (e) {
      if (e instanceof Expired) {
        alert(T.sess)
        location.reload()
        return
      }
      return say(T.err, true)
    }
    for (const a of als) {
      if (!seen.has(a.id)) {
        if (!first) {
          say((lang === 'hi' ? a.hi : a.en).slice(0, 160), a.state === 'danger')
          if (a.state === 'danger') speak(a)
        }
        seen.add(a.id)
      }
    }
    first = false
    world.setGauges(gs)
    world.setTeams(tms)
    world.setIncidents(incs)
    drawTop()
    drawQueue()
    drawRight()
    drawGauges()
  }

  if (boot.needLogin && boot.cfg) {
    login(boot.cfg, () => location.reload())
    return
  }
  if (!isDemo && api.roles.length && api.roles.every((r) => r === 'field_team')) {
    location.replace('field.html') // a rescue crew has its own phone page
    return
  }
  if (!isDemo && !api.roles.length) {
    say(T.noRole, true)
    api.signOut?.()
    return
  }
  setLang(lang)
  await refresh()
  setInterval(refresh, isDemo ? 2000 : 5000)

  // ---------------------------------------------------------------- login screen
  function login(cfg: Cfg, done: () => void): void {
    setLang(lang)
    const demo = h('button', 'btn ghost', T.tryDemo)
    demo.onclick = () => {
      location.search = '?demo=1'
    }
    showLogin(app, cfg, { login: T.login, email: T.email, pass: T.pass, newpass: T.newpass, code: T.code, go: T.go }, done, demo)
  }
}

void main()
