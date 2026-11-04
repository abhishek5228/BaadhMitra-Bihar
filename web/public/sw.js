// Keeps the report page usable with no signal. Same-origin GETs: serve the cached copy at once and
// refresh it in the background. API calls go to another origin and are never cached.
const V = 'bm-v1'
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(V).then((c) => c.addAll(['./report.html', './config.json', './manifest.webmanifest', './icon-192.png'])).then(() => self.skipWaiting()))
})
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== V).map((k) => caches.delete(k)))).then(() => self.clients.claim()))
})
self.addEventListener('fetch', (e) => {
  const r = e.request
  if (r.method !== 'GET' || new URL(r.url).origin !== location.origin) return
  e.respondWith(
    caches.open(V).then(async (c) => {
      const hit = await c.match(r, { ignoreSearch: true })
      const net = fetch(r)
        .then((res) => {
          if (res.ok) c.put(r, res.clone())
          return res
        })
        .catch(() => hit)
      return hit || net
    }),
  )
})
