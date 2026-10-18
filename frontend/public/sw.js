// Service worker: makes the app installable and quick to open.
// - Built assets (/assets/*, hashed) and piano samples: cache first, they never change.
// - Pages: network first, falling back to the cached app when offline.
// - The API is never cached; songs and scores always come live from the server.

const APP_CACHE = 'app-v1'
const SOUND_CACHE = 'piano-samples-v1'

self.addEventListener('install', (event) => {
  self.skipWaiting()
  event.waitUntil(caches.open(APP_CACHE).then((cache) => cache.addAll(['/', '/manifest.webmanifest', '/icon-192.png'])))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('app-') && k !== APP_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName)
  const cached = await cache.match(request)
  if (cached) return cached
  const response = await fetch(request)
  if (response.ok) cache.put(request, response.clone())
  return response
}

async function networkFirst(request) {
  try {
    const response = await fetch(request)
    if (response.ok) (await caches.open(APP_CACHE)).put('/', response.clone())
    return response
  } catch {
    return (await caches.match('/')) ?? Response.error()
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  const sameOrigin = url.origin === self.location.origin

  if (sameOrigin && url.pathname.startsWith('/api/')) return
  if (url.hostname === 'tonejs.github.io') event.respondWith(cacheFirst(request, SOUND_CACHE))
  else if (sameOrigin && url.pathname.startsWith('/assets/')) event.respondWith(cacheFirst(request, APP_CACHE))
  else if (request.mode === 'navigate') event.respondWith(networkFirst(request))
})
