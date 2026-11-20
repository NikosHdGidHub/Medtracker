/* Injected during the production build by Vite. */
const assets = self.__MEDTRACKER_ASSETS__
const cachePrefix = 'medtracker-static-' + self.registration.scope + '-'
const cacheName = cachePrefix + self.__MEDTRACKER_VERSION__
const index = new URL('index.html', self.registration.scope).href
const urls = new Set(assets.map(name => new URL(name, self.registration.scope).href))

self.addEventListener('install', event => {
  event.waitUntil(caches.open(cacheName)
    .then(cache => cache.addAll([...urls].map(url => new Request(url, { cache: 'reload' }))))
    .then(() => self.skipWaiting()))
})

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys
    .filter(key => key.startsWith(cachePrefix) && key !== cacheName)
    .map(key => caches.delete(key)))).then(() => self.clients.claim()))
})

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return
  const requestURL = new URL(event.request.url)
  requestURL.hash = ''
  const url = requestURL.href
  requestURL.search = ''
  if (event.request.mode === 'navigate' && (requestURL.href === index || requestURL.href === self.registration.scope)) {
    event.respondWith(caches.open(cacheName).then(async cache =>
      await cache.match(index) ?? fetch(event.request)))
  } else if (urls.has(url)) {
    event.respondWith(caches.open(cacheName).then(async cache =>
      await cache.match(url) ?? fetch(event.request)))
  }
})

self.addEventListener('notificationclick', event => {
  event.notification.close()
  event.waitUntil(self.clients.matchAll({ type: 'window' }).then(clients => {
    const existing = clients.find(client => client.url.startsWith(self.registration.scope))
    return existing ? existing.focus() : self.clients.openWindow(self.registration.scope + '#/today')
  }))
})
