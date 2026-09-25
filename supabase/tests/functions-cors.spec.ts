// Prueba el helper de CORS de las Edge Functions con sesión
// (supabase/functions/_shared/cors.ts).
//
// Se prueba como función pura (entra un Request, sale un Response) y no
// llamando a la función por HTTP a propósito: en local, Kong (el gateway de
// `supabase start`) contesta el preflight y añade sus propias cabeceras CORS
// ANTES de que la petición llegue a la función. Un test por HTTP pasaría
// aunque la función no hiciera nada, y fallaría solo en Supabase hospedado,
// donde nadie lo está mirando.
import { describe, expect, it } from 'vitest'

import { corsHeaders, handleCors, preflightResponse, withCors } from '../functions/_shared/cors'

describe('preflightResponse', () => {
  it('responde 204 sin cuerpo y con las cabeceras que supabase-js necesita', () => {
    // Es lo que el navegador pregunta antes de cada POST con sesión. Si
    // faltara una cabecera (p. ej. `x-client-info`, que supabase-js manda
    // siempre), el navegador cancelaría el POST y el dueño vería "no se
    // pudo dar de alta" sin que el servidor recibiera nada.
    const response = preflightResponse()

    expect(response.status).toBe(204)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*')
    const allowed = (response.headers.get('Access-Control-Allow-Headers') ?? '').split(',').map((h) => h.trim())
    expect(allowed).toEqual(expect.arrayContaining(['authorization', 'x-client-info', 'apikey', 'content-type']))
    expect(response.headers.get('Access-Control-Allow-Methods')).toContain('POST')
  })
})

describe('withCors', () => {
  it('añade CORS a una respuesta de error sin perder su estado ni su cuerpo', async () => {
    // Las respuestas de error (403, 409...) también necesitan CORS: sin
    // ellas el navegador oculta el cuerpo y la UI no puede mostrar el
    // mensaje en español de la función ("Ese correo ya está registrado"),
    // solo un error de red genérico.
    const original = Response.json({ message: 'Ese correo ya está registrado.' }, { status: 409 })

    const wrapped = withCors(original)

    expect(wrapped.status).toBe(409)
    expect(await wrapped.json()).toEqual({ message: 'Ese correo ya está registrado.' })
    for (const [name, value] of Object.entries(corsHeaders)) {
      expect(wrapped.headers.get(name)).toBe(value)
    }
  })

  it('conserva las cabeceras que la función ya había puesto', () => {
    // Borde: añadir CORS no debe pisar el Content-Type ni otras cabeceras
    // propias de la respuesta.
    const original = new Response('ok', { headers: { 'Content-Type': 'text/plain', 'X-Propia': '1' } })

    const wrapped = withCors(original)

    expect(wrapped.headers.get('Content-Type')).toBe('text/plain')
    expect(wrapped.headers.get('X-Propia')).toBe('1')
  })
})

describe('handleCors', () => {
  it('contesta el preflight OPTIONS sin llegar al manejador de la función', async () => {
    // El preflight llega SIN sesión. Si pasara por el manejador, este lo
    // rechazaría con 403 (falta el token) y el navegador cancelaría el POST
    // real: la función quedaría inservible desde el navegador.
    let handlerCalled = false
    const handler = handleCors(async () => {
      handlerCalled = true
      return Response.json({ message: 'no debería llegar aquí' }, { status: 403 })
    })

    const response = await handler(new Request('https://example.test/fn', { method: 'OPTIONS' }))

    expect(handlerCalled).toBe(false)
    expect(response.status).toBe(204)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*')
  })

  it('en un POST normal ejecuta el manejador y añade CORS a su respuesta', async () => {
    // El camino feliz: la lógica de la función no cambia, solo se le añaden
    // las cabeceras.
    const handler = handleCors(async () => Response.json({ tenantId: 'x' }))

    const response = await handler(new Request('https://example.test/fn', { method: 'POST' }))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ tenantId: 'x' })
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*')
  })

  it('añade CORS también cuando el manejador rechaza el método (405)', async () => {
    // Borde: las funciones devuelven 405 a todo lo que no sea POST. Ese
    // rechazo también debe llevar CORS, o el navegador lo reporta como
    // fallo de red en vez de "método no permitido".
    const handler = handleCors(async () => Response.json({ message: 'Método no permitido.' }, { status: 405 }))

    const response = await handler(new Request('https://example.test/fn', { method: 'GET' }))

    expect(response.status).toBe(405)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*')
  })
})
