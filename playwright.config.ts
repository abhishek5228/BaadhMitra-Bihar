// Browser tests against the built site in demo mode. No AWS needed.
//   npx playwright install chromium     (once)
//   npm run e2e
// If a Chromium is already on the machine, point PW_CHROMIUM at its executable instead of installing.
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.e2e.ts',
  timeout: 60_000,
  retries: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4177',
    launchOptions: { executablePath: process.env.PW_CHROMIUM || undefined, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] },
  },
  webServer: {
    command: 'npm run web:build && npx vite preview --config web/vite.config.ts web --port 4177',
    url: 'http://localhost:4177/index.html',
    reuseExistingServer: true,
    timeout: 180_000,
  },
})
