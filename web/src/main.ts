import './style.css'
import type { Alert, Gauge, Inc, Need } from '../../shared/types'
import { inBihar } from '../../shared/geo'
import { connect, setKey, type Api, type Pin, type St } from './api'
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
  const { api, url } = await connect()
  let lang: Lang = navigator.language.startsWith('hi') ? 'hi' : 'en'
  let T = dict(lang)
  let incs: Inc[] = []
  let gs: Gauge[] = []
  let als: Alert[] = []
  let st: St = { reports: 0, incidents: 0, rule: 0, review: 0, dedup: 0, unpl: 0 }
  let sel = ''
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
  app.append(stage, top, left, right, comp, bar, toast)

  const world = new World(stage, (id) => pickInc(id))

  const say = (m: string, bad = false) => {
    toast.replaceChildren(h('span', '', m))
    toast.className = 'toast' + (bad ? ' bad' : '')
    setTimeout(() => toast.classList.add('hide'), 6000)
  }

  // ------------------------------------------------------------------ header
  function drawTop(): void {
    if (!changed('top', [lang, st, incs.length, api.mode])) return
    const mode = h('span', 'mode ' + api.mode, api.mode === 'live' ? T.live : T.demo)
    const mk = (label: string, fn: () => void) => {
      const b = h('button', 'btn', label)
      b.onclick = fn
      return b
    }
    const stat = (v: string, l: string) => h('div', 'stat', h('b', '', v), h('span', '', l))
    const kids: K[] = [
      h('div', 'brand', h('div', 'logo', '🌊'), h('div', '', h('h1', '', T.title), h('p', '', T.sub))),
      h('div', 'stats', stat(String(st.reports), T.stats.reports), stat(String(incs.length), T.stats.inc), stat(Math.round(st.dedup * 100) + '%', T.stats.dedup), stat(String(st.rule), T.stats.rule), st.unpl ? stat(String(st.unpl), T.stats.unpl) : null),
      h('div', 'acts', mode),
    ]
    const acts = kids[2] as HTMLElement
    if (api.surge) acts.append(mk('⚡ ' + T.surge, () => api.surge?.()))
    if (api.mode === 'demo' && url) acts.append(mk('🔑 ' + T.connect, askKey))
    acts.append(mk(lang === 'en' ? 'हिं' : 'EN', () => setLang(lang === 'en' ? 'hi' : 'en')))
    top.replaceChildren(...(kids as Node[]))
  }

  function askKey(): void {
    const k = prompt(T.key)
    if (k && k.trim()) {
      setKey(k.trim())
      location.reload()
    }
  }

  // ------------------------------------------------------------------ queue
  function drawQueue(): void {
    if (!changed('q', [lang, sel, als.map((a) => a.id), incs.map((i) => [i.id, i.score, i.n, i.ppl, i.status, i.review, ago(i.last)])])) return
    const keep = left.querySelector('.list')?.scrollTop ?? 0 // a refresh must not yank the list back to the top
    const list = h('div', 'list')
    if (!incs.length) list.append(h('p', 'empty', T.none))
    for (const i of incs) {
      const row = h(
        'button',
        'row' + (i.id === sel ? ' on' : ''),
        h('span', 'sc', String(i.score)),
        h('span', 'rb', h('b', '', i.place), h('small', '', `${i.n} ${T.reporters} · ${ago(i.last)}${i.ppl ? ` · ${i.ppl} ${T.people}` : ''}`)),
        i.status === 'assigned' ? h('em', 'chip blue', T.assigned) : i.review ? h('em', 'chip warn', '?') : null,
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
    put(left, h('h2', '', T.queue), list, als.length ? h('h2', '', T.alerts) : null, als.length ? gl : null)
    list.scrollTop = keep
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
    for (const t of TEAMS) team.append(new Option(t, t))
    const go = h('button', 'btn go', '🚤 ' + T.assign)
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
      h('h3', '', T.msgs),
      sn,
      i.status === 'resolved' ? null : h('div', 'dispatch', team, go, done),
    )
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
    if (!changed('g', [lang, gs.map((g) => [g.id, g.lvl, g.state, g.trend])])) return
    bar.replaceChildren(
      ...gs.map((g) => {
        const c = h('div', 'g ' + g.state, h('b', '', g.name), h('span', '', `${g.lvl.toFixed(2)} m`), h('small', '', `${T.state[g.state]} · ${g.trend >= 0 ? '▲' : '▼'}${Math.abs(g.trend).toFixed(2)}`))
        if (g.sim) c.title = T.sim
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
      ;[incs, gs, als, st] = await Promise.all([api.incidents(), api.gauges(), api.alerts(), api.stats()])
    } catch {
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
    world.setIncidents(incs)
    drawTop()
    drawQueue()
    drawRight()
    drawGauges()
  }

  setLang(lang)
  await refresh()
  setInterval(refresh, api.mode === 'demo' ? 2000 : 5000)
}

void main()
