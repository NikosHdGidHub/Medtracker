import { devices, expect, test } from '@playwright/test'

test.use({
  ...devices['Pixel 7'],
  defaultBrowserType: 'chromium',
})

test('serves production assets, hash routes and the installable shell under /Medtracker/', async ({ page, context, request }) => {
  const failures: string[] = []
  page.on('pageerror', error => failures.push(error.message))
  await page.goto('./#/history')
  await expect(page.getByRole('heading', { name: 'Medtracker' })).toBeVisible()
  await expect(page.getByRole('alert')).toContainText('Firebase')
  const manifest = await request.get('./manifest.webmanifest')
  expect(manifest.ok()).toBe(true)
  const app = await manifest.json()
  expect(app).toMatchObject({ start_url: './#/today', scope: './', display: 'standalone' })
  for (const icon of app.icons) expect((await request.get(icon.src)).ok()).toBe(true)
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller?.scriptURL ?? '')).toContain('/Medtracker/sw.js')
  const staticRequests = await page.evaluate(async () => {
    const names = await caches.keys()
    const cache = await caches.open(names.find(name => name.startsWith('medtracker-static-'))!)
    return (await cache.keys()).map(request => request.url)
  })
  expect(staticRequests.length).toBeGreaterThan(4)
  expect(staticRequests.every(url => url.startsWith('http://127.0.0.1:5174/Medtracker/'))).toBe(true)
  await context.setOffline(true)
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Medtracker' })).toBeVisible()
  expect(failures).toEqual([])
  expect(await page.locator('html').evaluate(html => html.scrollWidth <= html.clientWidth)).toBe(true)
})
