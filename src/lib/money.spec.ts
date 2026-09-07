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

import {
  applyDiscount,
  formatMXN,
  parseMXNToCents,
  pesosToCents,
  splitTaxIncluded,
  sumLineItems,
} from './money'

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

// Estos son los tests que más importan de todo el proyecto (CLAUDE.md §9):
// si el desglose de IVA falla, el error se ve en el ticket que el dueño le
// entrega a un cliente real, y "el total no cuadra con la suma de las
// partidas" es exactamente el tipo de bug que hace quedar mal al negocio en
// una demo.
describe('splitTaxIncluded', () => {
  it('desglosa $350.00 con IVA al 16% incluido', () => {
    // Caso de catálogo real (CLAUDE.md §8.2): 35000 centavos con IVA
    // incluido se desglosan en 30172 de neto + 4828 de IVA.
    expect(splitTaxIncluded(35000, 1600)).toEqual({ netCents: 30172, taxCents: 4828 })
  })

  it('net + tax da siempre el precio original, sin importar el redondeo', () => {
    // Esta es la garantía que hace que un ticket cuadre: el impuesto se
    // obtiene por RESTA (gross - net), nunca calculándolo aparte. Si algún
    // día alguien "simplifica" esto a dos redondeos independientes, este
    // test se rompe apenas el redondeo caiga distinto en cada lado.
    const casos: Array<[number, number]> = [
      [35000, 1600],
      [1, 1600],
      [999, 800],
      [12345, 0],
      [0, 1600],
    ]
    for (const [grossCents, taxRateBp] of casos) {
      const { netCents, taxCents } = splitTaxIncluded(grossCents, taxRateBp)
      expect(netCents + taxCents).toBe(grossCents)
    }
  })

  it('un precio sin impuesto (0 basis points) no genera IVA', () => {
    expect(splitTaxIncluded(10000, 0)).toEqual({ netCents: 10000, taxCents: 0 })
  })

  it('precio 0 desglosa a 0 y 0, no revienta con división', () => {
    expect(splitTaxIncluded(0, 1600)).toEqual({ netCents: 0, taxCents: 0 })
  })

  it('redondea .5 centavos hacia arriba (Math.round, no truncar)', () => {
    // Caso sintético (100% de "impuesto", no una tasa real de IVA) elegido
    // a propósito para que el neto caiga justo en 50.5: sirve para probar
    // la REGLA de redondeo de la función, no un precio real del catálogo.
    expect(splitTaxIncluded(101, 10000)).toEqual({ netCents: 51, taxCents: 50 })
  })
})

describe('sumLineItems', () => {
  it('un carrito vacío suma cero en todo', () => {
    // Antes de agregar el primer servicio, useCartStore (tarea 5.12) va a
    // mostrar $0.00 de subtotal, IVA y total — no undefined ni NaN.
    expect(sumLineItems([])).toEqual({ subtotalCents: 0, taxCents: 0, totalCents: 0 })
  })

  it('una partida con precio 0 no rompe la suma (p. ej. una revisión de cortesía)', () => {
    expect(
      sumLineItems([{ unitPriceCents: 0, quantity: 1, taxRateBp: 1600 }]),
    ).toEqual({ subtotalCents: 0, taxCents: 0, totalCents: 0 })
  })

  it('multiplica por cantidad antes de desglosar el IVA de la partida', () => {
    // 2 baños de $105.00 (con IVA) al 16%: la partida completa es $210.00,
    // no dos desgloses de $105 sumados por separado — importa porque el
    // redondeo de $210 y el de 2×$105 no necesariamente coinciden.
    expect(
      sumLineItems([{ unitPriceCents: 10500, quantity: 2, taxRateBp: 1600 }]),
    ).toEqual({ subtotalCents: 18103, taxCents: 2897, totalCents: 21000 })
  })

  it('el IVA por partida y sumado difiere de calcularlo una sola vez sobre el total', () => {
    // El caso concreto que CLAUDE.md §8.2 pide evitar: tres partidas de
    // $1.05 (105 centavos) con IVA al 16%. Cada una desglosa a 91/14
    // (splitTaxIncluded(105, 1600)), así que la suma de las tres partidas
    // da subtotal 273 + IVA 42 = total 315.
    const items = [
      { unitPriceCents: 105, quantity: 1, taxRateBp: 1600 },
      { unitPriceCents: 105, quantity: 1, taxRateBp: 1600 },
      { unitPriceCents: 105, quantity: 1, taxRateBp: 1600 },
    ]
    const porPartida = sumLineItems(items)
    expect(porPartida).toEqual({ subtotalCents: 273, taxCents: 42, totalCents: 315 })

    // Si en vez de sumar las partidas ya desglosadas, alguien desglosara el
    // TOTAL de una sola vez, el redondeo cae distinto: 272/43 en vez de
    // 273/42. Mismo total (315), desglose distinto — la diferencia de un
    // centavo que un ticket no se puede dar el lujo de mostrar mal.
    const sobreElTotal = splitTaxIncluded(porPartida.totalCents, 1600)
    expect(sobreElTotal).not.toEqual({
      netCents: porPartida.subtotalCents,
      taxCents: porPartida.taxCents,
    })
    expect(sobreElTotal).toEqual({ netCents: 272, taxCents: 43 })
  })

  it('mezcla partidas con distinta tasa de impuesto', () => {
    // Un catálogo real puede tener servicios exentos junto a otros con IVA
    // (CLAUDE.md no lo prohíbe: tax_rate_bp vive por servicio). Cada
    // partida debe desglosarse con SU PROPIA tasa, no una tasa global.
    const items = [
      { unitPriceCents: 10000, quantity: 1, taxRateBp: 1600 }, // 8621 + 1379
      { unitPriceCents: 5000, quantity: 1, taxRateBp: 0 }, // 5000 + 0
    ]
    expect(sumLineItems(items)).toEqual({
      subtotalCents: 13621,
      taxCents: 1379,
      totalCents: 15000,
    })
  })
})

describe('applyDiscount', () => {
  it('resta el descuento del total', () => {
    expect(applyDiscount(35000, 5000)).toBe(30000)
  })

  it('un descuento mayor al total nunca deja el cobro en negativo', () => {
    // Error de dedo clásico en un formulario de descuento: capturar más de
    // lo que hay que cobrar. El resultado se recorta a 0, no a un total
    // negativo que un ticket no puede imprimir.
    expect(applyDiscount(10000, 15000)).toBe(0)
  })

  it('sin descuento, el total no cambia', () => {
    expect(applyDiscount(10000, 0)).toBe(10000)
  })
})

describe('parseMXNToCents', () => {
  it('parsea un texto con signo de pesos y decimales', () => {
    expect(parseMXNToCents('$350.00')).toBe(35000)
  })

  it('parsea un número simple sin signo de pesos', () => {
    expect(parseMXNToCents('350')).toBe(35000)
  })

  it('texto que no es un número da 0, no NaN', () => {
    // Alguien capturando el monto recibido en efectivo puede dejar el
    // campo vacío o teclear basura a medias — 0 es un estado válido para
    // que la UI diga "falta capturar el pago", NaN no lo es.
    expect(parseMXNToCents('')).toBe(0)
    expect(parseMXNToCents('abc')).toBe(0)
  })
})
