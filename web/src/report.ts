import './report.css'
import { citizen, type Pin } from './api'
import { add, flush, read, type Item } from './queue'
import { inBihar } from '../../shared/geo'
import { compose } from './compose'

// Hindi first, English second. Plain words, big buttons, works with no signal.
const NEEDS: [string, string, string][] = [
  ['boat', '🚤 नाव / Boat', 'नाव चाहिए'],
  ['food', '🍚 खाना / Food', 'खाना चाहिए'],
  ['water', '💧 पीने का पानी / Water', 'पीने का पानी चाहिए'],
  ['medical', '💊 दवा / Medicine', 'दवा चाहिए'],
  ['shelter', '⛺ आश्रय / Shelter', 'आश्रय चाहिए'],
]

function h(tag: string, cls = '', ...kids: (string | Node | null)[]): HTMLElement {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  for (const k of kids) if (k) e.append(k)
  return e
}

async function main(): Promise<void> {
  const root = document.getElementById('rp') as HTMLElement
  let api = ''
  try {
    api = ((await (await fetch('config.json')).json()) as { api?: string }).api ?? ''
  } catch {
    /* offline first visit: config comes from the service-worker cache next time */
  }
  const net = api ? citizen(api) : null
  let pin: Pin | undefined
  const picked = new Set<string>()

  const status = h('div', 'st')
  const note = (m: string, bad = false) => {
    status.className = 'st' + (bad ? ' bad' : ' ok')
    status.textContent = m
  }
  const waiting = h('div', 'wait')
  const drawWait = () => {
    const n = read().length
    waiting.textContent = n ? `📤 ${n} सूचना भेजने के लिए रुकी है (नेटवर्क आने पर अपने-आप जाएगी)` : ''
  }

  const place = h('input', 'inp') as HTMLInputElement
  place.placeholder = 'गाँव / पंचायत / ब्लॉक का नाम'
  place.maxLength = 80
  place.setAttribute('aria-label', 'गाँव / पंचायत / ब्लॉक का नाम')
  const ppl = h('input', 'inp small') as HTMLInputElement
  ppl.type = 'number'
  ppl.inputMode = 'numeric'
  ppl.min = '1'
  ppl.max = '9999'
  ppl.placeholder = 'कितने लोग?'
  ppl.setAttribute('aria-label', 'कितने लोग फँसे हैं?')
  const free = h('textarea', 'inp') as HTMLTextAreaElement
  free.rows = 3
  free.maxLength = 600
  free.setAttribute('aria-label', 'और जानकारी')
  free.placeholder = 'और कुछ बताना हो तो लिखें (बच्चे, बुजुर्ग, बीमार, पानी कितना ऊँचा...)'

  const chips = h('div', 'chips')
  for (const [k, label] of NEEDS) {
    const b = h('button', 'chip', label) as HTMLButtonElement
    b.type = 'button'
    b.setAttribute('aria-pressed', 'false')
    b.onclick = () => {
      const on = !picked.has(k)
      on ? picked.add(k) : picked.delete(k)
      b.setAttribute('aria-pressed', String(on))
      b.classList.toggle('on', on)
    }
    chips.append(b)
  }

  const loc = h('button', 'btn alt', '📍 मेरी जगह जोड़ें') as HTMLButtonElement
  loc.type = 'button'
  loc.onclick = () =>
    navigator.geolocation?.getCurrentPosition(
      (p) => {
        if (inBihar(p.coords.latitude, p.coords.longitude)) {
          pin = { lat: p.coords.latitude, lon: p.coords.longitude }
          loc.textContent = '📍 जगह जुड़ गई ✓'
          loc.classList.add('on')
        } else note('यह जगह बिहार के बाहर है, इसलिए नहीं जोड़ी।', true)
      },
      () => note('जगह नहीं मिली। गाँव का नाम लिख दें।', true),
      { enableHighAccuracy: true, timeout: 10000 },
    )

  const send = h('button', 'btn go', '📨 सूचना भेजें / Send') as HTMLButtonElement
  send.type = 'button'

  const push = async (i: Item): Promise<void> => {
    if (!net) throw new Error('no api')
    await net.report(i.text, i.pin)
  }
  const sweep = async (): Promise<void> => {
    if (!read().length) return
    const r = await flush(push)
    if (r.sent) note(`✓ ${r.sent} सूचना पहुँच गई। धन्यवाद।`)
    drawWait()
  }

  send.onclick = async () => {
    const text = compose(place.value, ppl.value, NEEDS.filter((n) => picked.has(n[0])).map((n) => n[2]), free.value)
    if (text.replace(/[\s,]/g, '').length < 3) return note('कृपया कुछ जानकारी भरें।', true)
    add(text, pin) // saved on the phone first; it can never be lost to a dropped connection
    drawWait()
    send.disabled = true
    try {
      const r = await flush(push)
      if (r.left === 0) {
        note('✓ सूचना कंट्रोल रूम तक पहुँच गई। धन्यवाद। आपातकाल में 112 पर कॉल करें।')
        place.value = ppl.value = free.value = ''
        picked.clear()
        chips.querySelectorAll('.chip').forEach((c) => c.classList.remove('on'))
      } else note('नेटवर्क नहीं है। सूचना फ़ोन में सुरक्षित है, नेटवर्क आते ही अपने-आप जाएगी।')
    } finally {
      send.disabled = false
      drawWait()
    }
  }

  root.replaceChildren(
    h('div', 'sos', '🆘 जान को खतरा हो तो अभी ', (() => { const a = h('a', 'tel', '112 पर कॉल करें') as HTMLAnchorElement; a.href = 'tel:112'; return a })()),
    h('h1', '', 'बाढ़मित्र'),
    h('p', 'lead', 'अपनी जगह और ज़रूरत बताएँ। सूचना सीधे बचाव कंट्रोल रूम की सूची में जाती है। यह बचाव की गारंटी नहीं है, सूचना देने का माध्यम है।'),
    place,
    ppl,
    h('div', 'lab', 'क्या चाहिए?'),
    chips,
    free,
    loc,
    send,
    status,
    waiting,
    h('p', 'fine', 'हम आपका फ़ोन नंबर नहीं माँगते। लिखे हुए फ़ोन नंबर हटा दिए जाते हैं।'),
  )
  drawWait()

  addEventListener('online', () => void sweep())
  setInterval(() => void sweep(), 30_000)
  void sweep()

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => undefined)
}

void main()
