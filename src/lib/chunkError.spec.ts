// Pruebas de isChunkLoadError: distingue "no se pudo descargar la pantalla" (versión
// nueva publicada) de cualquier otro error.
import { describe, expect, it } from 'vitest'

import { isChunkLoadError } from './chunkError'

describe('isChunkLoadError', () => {
  // Qué prueba: los tres textos reales de los navegadores. Si falla uno, quien use ese
  // navegador se quedaría con la pantalla muda tras un despliegue, sin aviso.
  it.each([
    [
      'Chrome',
      'Failed to fetch dynamically imported module: https://x.mx/assets/Agenda-a1.js',
    ],
    [
      'Firefox',
      'error loading dynamically imported module: https://x.mx/assets/Agenda-a1.js',
    ],
    ['Safari', 'Importing a module script failed.'],
    ['Vite (CSS)', 'Unable to preload CSS for /assets/Agenda-a1.css'],
  ])('reconoce el mensaje de %s', (_browser, message) => {
    expect(isChunkLoadError(new TypeError(message))).toBe(true)
  })

  // Qué prueba: que no se confunda cualquier error con una versión nueva. Si fallara,
  // un error real de una pantalla le diría a la persona "recarga", y recargar no lo arregla.
  it('no toma como versión nueva los errores que no son de importación', () => {
    expect(isChunkLoadError(new Error('Network request failed'))).toBe(false)
    expect(isChunkLoadError(new TypeError('Cannot read properties of undefined'))).toBe(
      false,
    )
    expect(isChunkLoadError(new Error('NavigationDuplicated'))).toBe(false)
  })

  // Qué prueba: bordes. El router puede entregar cualquier cosa; la función no debe
  // tronar con valores raros (tronar dentro de un manejador de errores es peor que el error).
  it('no truena con valores que no son errores', () => {
    expect(isChunkLoadError(undefined)).toBe(false)
    expect(isChunkLoadError(null)).toBe(false)
    expect(isChunkLoadError(42)).toBe(false)
    expect(isChunkLoadError({})).toBe(false)
  })

  // Qué prueba: errores que llegan como texto suelto u objeto con `message` (algunos
  // navegadores o librerías no lanzan instancias de Error).
  it('acepta texto suelto y objetos con message', () => {
    expect(isChunkLoadError('Importing a module script failed.')).toBe(true)
    expect(
      isChunkLoadError({ message: 'Failed to fetch dynamically imported module: x' }),
    ).toBe(true)
  })
})
