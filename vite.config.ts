import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import type { Plugin } from 'vite'

function serviceWorker(): Plugin {
  return {
    name: 'medtracker-static-cache',
    apply: 'build',
    writeBundle({ dir }, bundle) {
      if (!dir) return
      const assets = [...new Set(['index.html', ...Object.keys(bundle), 'manifest.webmanifest',
        'icons/icon-192.png', 'icons/icon-512.png'])].sort()
      const template = readFileSync(new URL('./service-worker.js', import.meta.url), 'utf8')
      const version = createHash('sha256').update(template)
      for (const file of assets) version.update(readFileSync(join(dir, file)))
      writeFileSync(join(dir, 'sw.js'), template
        .replace('self.__MEDTRACKER_ASSETS__', JSON.stringify(assets))
        .replace('self.__MEDTRACKER_VERSION__', JSON.stringify(version.digest('hex').slice(0, 16))))
    },
  }
}

export default defineConfig({
  base: '/Medtracker/',
  plugins: [react(), serviceWorker()],
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: 'firestore', test: /node_modules[/\\]@firebase[/\\]firestore/ },
            { name: 'firebase-auth', test: /node_modules[/\\]@firebase[/\\]auth/ },
            { name: 'calendar', test: /node_modules[/\\](?:@js-temporal|jsbi)/ },
          ],
        },
      },
    },
  },
})
