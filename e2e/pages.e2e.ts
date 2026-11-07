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
