import { defineConfig, devices } from '@playwright/test'

const production = process.argv.includes('production')
const origin = 'http://127.0.0.1:5174'
const baseURL = origin + '/Medtracker/'
export default defineConfig({
  testDir: './tests/browser',
  projects: [
    { name: 'tracker', testMatch: 'tracker.spec.ts' },
    { name: 'production', testMatch: 'production.spec.ts' },
  ],
  workers: 1,
  use: {
    ...devices['Desktop Chrome'],
    baseURL,
    launchOptions: {
      executablePath: process.env.MEDTRACKER_CHROMIUM,
      args: ['--no-proxy-server'],
    },
  },
  webServer: {
    command: production ? 'npm run preview -- --host 127.0.0.1 --port 5174 --strictPort'
      : 'npm run dev -- --host 127.0.0.1 --port 5174 --strictPort',
    url: baseURL,
    env: { VITE_USE_FIREBASE_EMULATORS: production ? 'false' : 'true', VITE_ALLOW_REGISTRATION: 'true' },
    reuseExistingServer: false,
  },
})
