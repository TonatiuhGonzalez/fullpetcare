// Service worker de FullPetCare (fase 16A, PLAN.md D21).
//
// Para qué sirve: que la app se pueda instalar en el teléfono y que, sin red, muestre una
// pantalla de "sin conexión" en lugar del error del navegador.
//
// Qué NO hace, a propósito:
//  - NO guarda datos de ninguna mascota. Los datos viven en la Edge Function
//    `public-pet-view` (otro dominio), y este archivo ignora toda petición a otro dominio.
//    Así un token revocado o vencido deja de mostrar información aunque el teléfono haya
//    estado sin red: no hay copia que enseñar.
//  - NO guarda las pantallas (index.html). Sin red una navegación cae en /offline.html.
//
// Qué SÍ guarda: los archivos con nombre con hash de /assets/ (JS, CSS, fuentes). Un archivo
// con hash nunca cambia de contenido, así que se puede servir de la caché sin riesgo.
//
// Para invalidar todo, sube VERSION.
const VERSION = 'v1'
const SHELL_CACHE = `fpc-shell-${VERSION}`
const ASSET_CACHE = `fpc-assets-${VERSION}`
const OFFLINE_URL = '/offline.html'
const PRECACHE = [OFFLINE_URL, '/favicon.svg', '/icons/icon-192.png', '/icons/icon-512.png']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      // Una versión nueva toma el control sin esperar a que se cierren todas las pestañas.
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith('fpc-') && key !== SHELL_CACHE && key !== ASSET_CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const request = event.request

  // Solo lecturas. Una escritura (POST, PATCH…) nunca se intercepta.
  if (request.method !== 'GET') return

  const url = new URL(request.url)

  // Otro dominio (Supabase, la Edge Function, las fotos): se deja pasar tal cual.
  if (url.origin !== self.location.origin) return

  // Navegación a una pantalla: siempre a la red; sin red, la página de "sin conexión".
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => caches.match(OFFLINE_URL)))
    return
  }

  // Archivos con hash de la app: de la caché si ya están; si no, de la red y se guardan.
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.open(ASSET_CACHE).then((cache) =>
        cache.match(request).then(
          (cached) =>
            cached ||
            fetch(request).then((response) => {
              // Solo respuestas buenas: guardar un 404 o un error dejaría la app rota.
              if (response.ok) cache.put(request, response.clone())
              return response
            }),
        ),
      ),
    )
  }
})
