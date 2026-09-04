// Este es el PRIMER test del proyecto. Su objetivo real no es "probar
// formatMXN a fondo" (eso vendrá con más casos en la fase 5) — es
// confirmar que el runner de pruebas (Vitest) está bien conectado: que
// encuentra el archivo, que corre los casos, y que si algo se rompe, se ve
// en rojo. Sin esta pieza funcionando, ningún test posterior es confiable.
//
// Anatomía de un archivo de test, para quien nunca escribió uno:
//
// - `describe(nombre, fn)` agrupa varios casos relacionados bajo un mismo
//   título. Es puramente organizativo — no cambia si el test pasa o falla.
//   Aquí agrupamos "todo lo que prueba formatMXN".
//
// - `it(nombre, fn)` es UN caso concreto. El nombre no es decorativo:
//   cuando este test falle dentro de un año, lo primero (y a veces lo
//   único) que vas a leer es ese nombre en la terminal. Por eso se escribe
//   como una frase que describe el COMPORTAMIENTO esperado
//   ("formatea centavos como pesos con dos decimales"), no la
//   implementación ("llama a Intl.NumberFormat").
//
// - `expect(valorObtenido).toBe(valorEsperado)` es la comprobación en sí:
//   ejecuta la función con una entrada conocida y compara la salida contra
//   lo que debería dar. Si no coincide, Vitest imprime ambos valores para
//   que veas la diferencia de inmediato.
import { describe, expect, it } from 'vitest'

import { formatMXN, pesosToCents } from './money'

describe('formatMXN', () => {
  it('formatea centavos como pesos con dos decimales', () => {
    // Caso principal: 35000 centavos son $350.00 pesos. Este es el "camino
    // feliz" — si esto falla, algo básico del formateador se rompió.
    expect(formatMXN(35000)).toBe('$350.00')
  })

  it('conserva los centavos que no son .00', () => {
    // 12345 centavos = $123.45. Importa porque un bug común es truncar o
    // redondear mal la división entre 100 (p. ej. con floats en vez de
    // enteros) y perder justo los centavos, que es el dato que más importa
    // en un ticket.
    expect(formatMXN(12345)).toBe('$123.45')
  })

  it('formatea cero como $0.00, no como cadena vacía ni "$0"', () => {
    // Un servicio con precio 0 (p. ej. una revisión de cortesía) es un
    // caso de borde real, no hipotético. Si formatMXN devolviera algo raro
    // con 0, el ticket se vería roto justo en ese renglón.
    expect(formatMXN(0)).toBe('$0.00')
  })
})

describe('pesosToCents', () => {
  it('convierte pesos con centavos exactos', () => {
    expect(pesosToCents(250.5)).toBe(25050)
  })

  it('redondea en vez de truncar, para no perder un centavo por un float mal representado', () => {
    // 3.1 * 100 en JS da 309.99999999999994, no 310 — truncar (Math.floor)
    // devolvería 309 centavos, un peso completo menos de lo que alguien
    // capturó. Es exactamente el tipo de bug de punto flotante que
    // CLAUDE.md §8.2 dice evitar guardando siempre enteros.
    expect(pesosToCents(3.1)).toBe(310)
  })

  it('pesos enteros no ganan centavos de la nada', () => {
    expect(pesosToCents(500)).toBe(50000)
  })
})
