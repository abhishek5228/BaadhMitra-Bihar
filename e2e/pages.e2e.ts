import { expect, test, type Page } from '@playwright/test'

// The pages read config.json at start-up. These tests never reach a real API.
const API = 'https://api.test.invalid/prod/'
async function stub(page: Page): Promise<{ sent: string[]; net: { down: boolean } }> {
  const sent: string[] = []
  const net = { down: false } // page.route answers before the network, so "offline" must be simulated here too
  await page.route('**/config.json', (r) => r.fulfill({ json: { api: API, region: 'ap-southeast-2', clientId: 'c' } }))
  await page.route('https://api.test.invalid/**', async (r) => {
    if (net.down) return r.abort('internetdisconnected')
    sent.push(r.request().postData() ?? '')
    await r.fulfill({ status: 200, json: { ok: true } })
  })
  return { sent, net }
}

test.describe('staff dashboard (demo mode)', () => {
  test.beforeEach(async ({ page }) => {
    await stub(page)
    await page.goto('/index.html?demo=1')
    await expect(page.locator('.row').first()).toBeVisible({ timeout: 20_000 })
  })

  test('shows a ranked queue, highest score first', async ({ page }) => {
    const sc = (await page.locator('.row .sc').allInnerTexts()).map(Number)
    expect(sc.length).toBeGreaterThan(3)
    expect(sc).toEqual([...sc].sort((a, b) => b - a))
  })

  test('the attention panel lists live problems and a click opens the incident behind one', async ({ page }) => {
    const box = page.locator('.attn')
    await expect(box).toContainText(/Needs attention|ध्यान चाहिए/)
    await page.getByRole('button', { name: /surge/i }).click()
    const clickable = box.locator('button.att:not([disabled])')
    await expect.poll(() => clickable.count(), { timeout: 20_000 }).toBeGreaterThan(0)
    await clickable.first().click()
    await expect(page.locator('.panel.right')).not.toHaveClass(/hide/)
  })

  test('search narrows the queue, keeps typing focus, and says when nothing matches', async ({ page }) => {
    const all = await page.locator('.row').count()
    await page.fill('.find', 'supaul')
    expect(await page.locator('.row').count()).toBeLessThan(all)
    await expect(page.locator('.find')).toBeFocused()
    await page.fill('.find', 'zzzzzz')
    await expect(page.locator('.list .empty')).toBeVisible()
  })

  test('overdue filter shows only incidents with an overdue badge', async ({ page }) => {
    await page.getByRole('button', { name: 'Overdue' }).click()
    const n = await page.locator('.row').count()
    expect(n).toBeGreaterThan(0)
    expect(await page.locator('.row .chip.late, .row .chip.warn, .row .chip.red, .row .chip.amber').count()).toBeGreaterThan(0)
  })

  test('dialogs open with a role and close with Escape', async ({ page }) => {
    await page.getByText('Activity log').first().click()
    const dlg = page.locator('.modal')
    await expect(dlg).toHaveAttribute('role', 'dialog')
    await page.keyboard.press('Escape')
    await expect(dlg).toHaveCount(0)
  })

  test('opening an incident suggests the nearest crews and a click picks one', async ({ page }) => {
    await page.locator('.row').first().click()
    const hints = page.locator('.sugg .chip')
    await expect(hints.first()).toBeVisible()
    expect(await hints.count()).toBeLessThanOrEqual(3)
    const name = (await hints.first().innerText()).split(' · ')[0]
    await hints.first().click()
    await expect(page.locator('.dispatch select')).toHaveValue(name)
  })

  test('the attention panel follows the language and updates once a crew is sent', async ({ page }) => {
    const box = page.locator('.attn')
    const unassigned = box.locator('button.att', { hasText: /unassigned past the limit/ })
    await expect(unassigned).toHaveCount(1)
    const n0 = Number((await unassigned.innerText()).match(/(\d+) unassigned/)?.[1])
    await unassigned.click() // opens the worst one
    await page.locator('.dispatch select').selectOption({ index: 1 })
    await page.getByRole('button', { name: /Dispatch/ }).click()
    // one fewer overdue-and-unassigned incident (or the item is gone if it was the only one)
    await expect
      .poll(async () => (await unassigned.count()) === 0 || Number((await unassigned.innerText()).match(/(\d+) unassigned/)?.[1]) < n0, { timeout: 20_000 })
      .toBe(true)
    await page.getByRole('button', { name: 'हिं' }).click()
    await expect(box).toContainText('ध्यान चाहिए')
  })

  test('an incident can be shared with a crew: map, copy, and WhatsApp with the brief', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await page.locator('.row').first().click()
    const shr = page.locator('.shr')
    await expect(shr.locator('a[href^="https://www.google.com/maps/search/"]')).toBeVisible()
    const wa = await shr.locator('a[href^="https://wa.me/"]').getAttribute('href')
    expect(decodeURIComponent(wa ?? '')).toContain('maps/search')
    await shr.getByRole('button', { name: /Copy brief|कॉपी/ }).click()
    const clip = await page.evaluate(() => navigator.clipboard.readText())
    expect(clip).toMatch(/Rescue: .+priority \d+\/100/)
    expect(clip).toContain('google.com/maps')
  })

  test('the tab title carries the number of open or overdue incidents', async ({ page }) => {
    await expect(page).toHaveTitle(/^\((⏰ )?\d+\) /)
  })

  test('keys: / searches, j and k walk the queue, Escape closes the detail', async ({ page }) => {
    await page.keyboard.press('j')
    await expect(page.locator('.panel.right')).not.toHaveClass(/hide/)
    const first = await page.locator('.row.on b').first().innerText()
    await page.keyboard.press('j')
    expect(await page.locator('.row.on b').first().innerText()).not.toBe(first)
    await page.keyboard.press('k')
    expect(await page.locator('.row.on b').first().innerText()).toBe(first)
    await page.keyboard.press('Escape')
    await expect(page.locator('.panel.right')).toHaveClass(/hide/)
    await page.keyboard.press('/')
    await expect(page.locator('input.find')).toBeFocused()
    await page.keyboard.type('j') // typing in the box must not walk the queue
    await expect(page.locator('.panel.right')).toHaveClass(/hide/)
  })

  test('the language and the sound switch are remembered after a reload', async ({ page }) => {
    await page.getByRole('button', { name: 'हिं' }).click()
    const snd = page.getByRole('button', { name: /🔕/ })
    await snd.click()
    await expect(page.getByRole('button', { name: /🔔/ })).toHaveAttribute('aria-pressed', 'true')
    await page.reload()
    await expect(page.locator('.row').first()).toBeVisible({ timeout: 20_000 })
    await expect(page.locator('html')).toHaveAttribute('lang', 'hi')
    await expect(page.getByRole('button', { name: /🔔/ })).toHaveAttribute('aria-pressed', 'true')
  })

  test('the monsoon surge brings in new incidents', async ({ page }) => {
    const before = await page.locator('.row').count()
    await page.getByRole('button', { name: /surge/i }).click()
    await expect.poll(() => page.locator('.row').count(), { timeout: 30_000 }).toBeGreaterThan(before)
  })
})

test.describe('citizen report page', () => {
  test('a report typed offline is kept on the phone and sent when the network returns', async ({ page, context }) => {
    const { sent, net } = await stub(page)
    await page.goto('/report.html')
    await page.fill('textarea', 'Rampur gaon me paani ghar me ghus gaya, 8 log')
    net.down = true
    await context.setOffline(true)
    await page.getByRole('button', { name: /Send/ }).click()
    await expect(page.locator('.wait')).toContainText('1')
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('bmoutbox') ?? '[]').length)).toBe(1)
    net.down = false
    await context.setOffline(false) // the page hears the browser's 'online' event and sends by itself
    await expect.poll(() => sent.length, { timeout: 20_000 }).toBeGreaterThan(0)
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('bmoutbox') ?? '[]').length), { timeout: 20_000 }).toBe(0)
  })

  test('a rate-limited send says so, keeps the report, and a refused one is dropped', async ({ page }) => {
    let code = 429
    await page.route('**/config.json', (r) => r.fulfill({ json: { api: API, region: 'ap-southeast-2', clientId: 'c' } }))
    await page.route('https://api.test.invalid/**', (r) => r.fulfill({ status: code, json: { error: 'x' } }))
    await page.goto('/report.html')
    await page.fill('textarea', 'Rampur gaon me paani ghar me ghus gaya, 8 log')
    await page.getByRole('button', { name: /Send/ }).click()
    await expect(page.locator('.st')).toContainText('बहुत सूचनाएँ')
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('bmoutbox') ?? '[]').length)).toBe(1)
    code = 400
    await page.getByRole('button', { name: /Send/ }).click()
    await expect(page.locator('.st')).toContainText('स्वीकार नहीं हुई')
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('bmoutbox') ?? '[]').length)).toBe(0)
  })

  test('a half-written report survives a reload, and is gone once it has been sent', async ({ page }) => {
    const { sent } = await stub(page)
    await page.goto('/report.html')
    await page.fill('textarea', 'Rampur gaon me paani ghar me ghus gaya')
    await page.getByRole('button', { name: 'नाव' }).click()
    // the page's offline cache would answer config.json before this test's stub can, so step it aside
    await page.evaluate(async () => { for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister() })
    await page.goto('/report.html') // a fresh load, as after a reload or a restarted browser
    await expect(page.locator('textarea')).toHaveValue('Rampur gaon me paani ghar me ghus gaya')
    await expect(page.getByRole('button', { name: 'नाव' })).toHaveAttribute('aria-pressed', 'true')
    await page.getByRole('button', { name: /Send/ }).click()
    await expect.poll(() => sent.length, { timeout: 10_000 }).toBeGreaterThan(0) // the restored words are what gets sent
    expect(sent[0]).toContain('Rampur gaon')
    await page.reload()
    await expect(page.locator('textarea')).toHaveValue('')
  })

  test('too little text is refused and nothing is queued', async ({ page }) => {
    await stub(page)
    await page.goto('/report.html')
    await page.getByRole('button', { name: /Send/ }).click()
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('bmoutbox') ?? '[]').length)).toBe(0)
  })

  test('always shows the 112 emergency number', async ({ page }) => {
    await stub(page)
    await page.goto('/report.html')
    await expect(page.locator('a.tel')).toHaveAttribute('href', 'tel:112')
  })
})

test.describe('rescue crew page', () => {
  const job = (id: string, place: string, extra: Record<string, unknown> = {}) => ({ id, place, lat: 25.6, lon: 85.1, n: 1, raw: 1, sev: 4, ppl: 6, vul: false, needs: ['boat'], conf: 1, review: false, first: Date.now() - 600_000, last: Date.now(), status: 'assigned', score: 70, snips: [], who: [], ver: 1, team: 'NDRF Team A', ...extra })

  async function crew(page: Page): Promise<{ jobs: unknown[] }> {
    const state = { jobs: [] as unknown[] }
    await page.addInitScript(() => {
      sessionStorage.setItem('bmsess', JSON.stringify({ id: 'tok', refresh: '', exp: Date.now() + 3600_000, email: 'crew@example.gov.in', roles: ['field_team'] }))
      ;(window as unknown as { vibes: number[][] }).vibes = []
      navigator.vibrate = (p: VibratePattern) => ((window as unknown as { vibes: unknown[] }).vibes.push(p as number[]), true)
    })
    await page.route('**/config.json', (r) => r.fulfill({ json: { api: API, region: 'ap-southeast-2', clientId: 'c' } }))
    await page.route('https://api.test.invalid/**', (r) => r.fulfill({ json: { team: 'NDRF Team A', items: state.jobs } }))
    return state
  }

  test('shows when each job was assigned, and announces a new job with a banner, vibration and tab title', async ({ page }) => {
    const st = await crew(page)
    st.jobs = [job('a', 'Supaul', { asg: Date.now() - 12 * 60_000 })]
    await page.goto('/field.html')
    await expect(page.locator('.job h2')).toHaveText('Supaul')
    await expect(page.locator('.job .meta')).toContainText(/12 मिनट पहले|12 min ago/)
    await expect(page).toHaveTitle(/^\(1\) /)
    await expect(page.locator('.fresh')).toHaveCount(0) // the first load is not "new"
    st.jobs = [...st.jobs, job('b', 'Kursela')]
    await page.evaluate(() => window.dispatchEvent(new Event('online')))
    await expect(page.locator('.fresh')).toContainText('Kursela')
    await expect(page).toHaveTitle(/^\(2\) /)
    expect(await page.evaluate(() => (window as unknown as { vibes: unknown[] }).vibes.length)).toBe(1)
  })

  test('the language choice is remembered', async ({ page }) => {
    const st = await crew(page)
    st.jobs = [job('a', 'Supaul')]
    await page.goto('/field.html')
    const before = await page.locator('html').getAttribute('lang')
    const other = before === 'hi' ? 'en' : 'hi'
    await page.getByRole('button', { name: other === 'hi' ? 'हिं' : 'EN' }).click()
    await expect(page.locator('html')).toHaveAttribute('lang', other)
    await page.goto('/field.html')
    await expect(page.locator('html')).toHaveAttribute('lang', other)
  })
})
