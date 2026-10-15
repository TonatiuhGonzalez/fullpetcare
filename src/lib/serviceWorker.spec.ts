// Prueba el service worker real (public/sw.js) de la fase 16A: carga el archivo tal cual en
// un "navegador de mentira" mínimo y dispara sus eventos. Es la prueba de la promesa más
// importante de D21: la app instalada nunca guarda datos de la mascota.
import { describe, expect, it, vi } from 'vitest'

// `?raw` trae el archivo como texto (Vite): así la prueba no necesita `node:fs` ni tipos de Node.
import SOURCE from '../../public/sw.js?raw'

type Listener = (event: unknown) => void

/** Carga sw.js con un `self`, `caches` y `fetch` de mentira y devuelve lo que registró. */
function loadWorker(fetchImpl: (request: Request) => Promise<Response>) {
  const listeners: Record<string, Listener> = {}
  const stores = new Map<string, Map<string, Response>>()

  const caches = {
    open: async (name: string) => {
      if (!stores.has(name)) stores.set(name, new Map())
      const store = stores.get(name)!
      return {
        addAll: async (urls: string[]) => {
          for (const url of urls)
            store.set(new URL(url, 'https://app.test').href, new Response('x'))
        },
        match: async (request: Request) => store.get(request.url),
        put: async (request: Request, response: Response) => {
          store.set(request.url, response)
        },
      }
    },
    match: async (url: string) => {
      const href = new URL(url, 'https://app.test').href
      for (const store of stores.values()) {
        const hit = store.get(href)
        if (hit) return hit
      }
      return undefined
    },
    keys: async () => [...stores.keys()],
    delete: async (name: string) => stores.delete(name),
  }

  const self = {
    location: { origin: 'https://app.test' },
    addEventListener: (type: string, listener: Listener) => {
      listeners[type] = listener
    },
    skipWaiting: vi.fn(async () => undefined),
    clients: { claim: vi.fn(async () => undefined) },
  }

  new Function('self', 'caches', 'fetch', SOURCE)(self, caches, fetchImpl)
  return { listeners, stores, self }
}

/** Dispara un `fetch` y dice si el worker lo atendió (respondWith) y con qué. */
async function dispatchFetch(
  listeners: Record<string, Listener>,
  request: Request,
): Promise<{ handled: boolean; response?: Response }> {
  let handled = false
  let responsePromise: Promise<Response> | undefined
  listeners.fetch({
    request,
    respondWith: (value: Promise<Response>) => {
      handled = true
      responsePromise = value
    },
  })
  return { handled, response: responsePromise ? await responsePromise : undefined }
}

function navigation(url: string): Request {
  const request = new Request(url)
  Object.defineProperty(request, 'mode', { value: 'navigate' })
  return request
}

describe('public/sw.js', () => {
  // Qué prueba: una petición a otro dominio (la Edge Function de Supabase, que es donde
  // viven los datos de la mascota) NO la intercepta el worker.
  // Qué se rompería: se podrían guardar datos de una mascota en la caché del teléfono, y un
  // link revocado seguiría mostrándolos sin red. Es la promesa central de D21.
  it('no intercepta las peticiones a otro dominio (los datos de la mascota)', async () => {
    const { listeners } = loadWorker(async () => new Response('datos'))
    const result = await dispatchFetch(
      listeners,
      new Request('https://abc.supabase.co/functions/v1/public-pet-view'),
    )
    expect(result.handled).toBe(false)
  })

  // Qué prueba: las escrituras nunca se tocan.
  it('no intercepta una escritura', async () => {
    const { listeners } = loadWorker(async () => new Response('ok'))
    const result = await dispatchFetch(
      listeners,
      new Request('https://app.test/c/token', { method: 'POST', body: '{}' }),
    )
    expect(result.handled).toBe(false)
  })

  // Qué prueba: sin red, una pantalla muestra la página de "sin conexión", nunca datos.
  it('sin red, una navegación cae en la página de sin conexión', async () => {
    const { listeners } = loadWorker(async () => {
      throw new TypeError('Failed to fetch')
    })
    await listeners.install({ waitUntil: (p: Promise<unknown>) => p })
    const result = await dispatchFetch(listeners, navigation('https://app.test/c/abc'))
    expect(result.handled).toBe(true)
    expect(await result.response?.text()).toBe('x') // lo precargado: /offline.html
  })

  // Qué prueba: con red, la navegación va a la red y su respuesta NO se guarda.
  // Qué se rompería: el index.html (o una pantalla) quedaría cacheado y sin red se vería una
  // pantalla vieja en lugar del aviso.
  it('con red, la navegación sale a la red y no se guarda', async () => {
    const { listeners, stores } = loadWorker(async () => new Response('<html>app</html>'))
    await listeners.install({ waitUntil: (p: Promise<unknown>) => p })
    const result = await dispatchFetch(listeners, navigation('https://app.test/c/abc'))
    expect(await result.response?.text()).toBe('<html>app</html>')
    for (const store of stores.values()) {
      expect([...store.keys()]).not.toContain('https://app.test/c/abc')
    }
  })

  // Qué prueba: los archivos con hash de /assets/ sí se guardan, y la segunda vez salen de la
  // caché sin pedirlos a la red.
  it('guarda los archivos con hash de /assets/ y los sirve de la caché', async () => {
    const fetchImpl = vi.fn(async () => new Response('js'))
    const { listeners } = loadWorker(fetchImpl)

    const first = await dispatchFetch(
      listeners,
      new Request('https://app.test/assets/app-1a2b.js'),
    )
    expect(first.handled).toBe(true)
    await first.response?.text()
    // `cache.put` corre sin esperar: se deja pasar un turno antes de pedir de nuevo.
    await new Promise((resolve) => setTimeout(resolve, 0))

    const second = await dispatchFetch(
      listeners,
      new Request('https://app.test/assets/app-1a2b.js'),
    )
    expect(await second.response?.text()).toBe('js')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  // Qué prueba: un 404 de un archivo con hash no se guarda (dejaría la app rota para siempre).
  it('no guarda una respuesta con error', async () => {
    const fetchImpl = vi.fn(async () => new Response('no', { status: 404 }))
    const { listeners } = loadWorker(fetchImpl)

    const first = await dispatchFetch(
      listeners,
      new Request('https://app.test/assets/roto.js'),
    )
    await first.response?.text()
    await new Promise((resolve) => setTimeout(resolve, 0))
    await dispatchFetch(listeners, new Request('https://app.test/assets/roto.js'))

    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  // Qué prueba: un archivo estático que no es de /assets/ (ej. /offline.html pedido directo)
  // se deja pasar sin guardarse.
  it('deja pasar lo que no es navegación ni /assets/', async () => {
    const { listeners } = loadWorker(async () => new Response('x'))
    const result = await dispatchFetch(
      listeners,
      new Request('https://app.test/favicon.svg'),
    )
    expect(result.handled).toBe(false)
  })
})
