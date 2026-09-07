// El dinero se guarda y se calcula siempre en CENTAVOS ENTEROS (ver CLAUDE.md
// §8.2). formatMXN es la única función que lo convierte a algo legible para
// una persona, y solo debe llamarse al MOSTRAR — nunca antes de guardar o
// calcular. pesosToCents hace lo inverso: lo que alguien captura en un
// formulario ("$250.00") se vuelve centavos enteros para guardar.
//
// =============================================================================
// El IVA va incluido en el precio, y se desglosa HACIA ATRÁS (CLAUDE.md §8.2)
// =============================================================================
// En el mostrador mexicano, el precio de lista YA incluye el IVA: si el
// catálogo dice "$350.00", eso es lo que paga el cliente, no $350 + 16%
// aparte. El ticket necesita mostrar el desglose (subtotal sin IVA + IVA),
// así que hay que ir del precio final hacia el neto, no al revés:
//
//   net = round(gross * 10000 / (10000 + tax_rate_bp))
//   tax = gross - net
//
// (tax_rate_bp en basis points: 1600 = 16.00%, ver CLAUDE.md §6.3). La resta
// en vez de un segundo `round(gross * tax_rate_bp / ...)` es a propósito:
// así `net + tax` da EXACTO el precio original, siempre, sin importar cómo
// haya caído el redondeo — es la garantía que pide 5.10 (los totales del
// checkout deben cuadrar centavo a centavo).
//
// El IVA se calcula POR PARTIDA y luego se suma — nunca sobre el total del
// carrito. Sumar primero y desglosar después puede dar un resultado distinto
// por el redondeo de cada partida (ver el test "difiere de calcularlo sobre
// el total" en money.spec.ts para un caso real). Por partida es lo que hace
// el SAT, y evita que el ticket muestre un total que no cuadra con la suma
// de sus líneas.

/**
 * Convierte centavos (p. ej. 35000) a un texto de pesos mexicanos
 * (p. ej. "$350.00"), usando el formato de número que usa México
 * (separador de miles con coma, decimales con punto).
 */
export function formatMXN(cents: number): string {
  const pesos = cents / 100
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN',
  }).format(pesos)
}

/**
 * Convierte pesos (lo que alguien captura en un formulario, p. ej. 250.5)
 * a centavos enteros (25050) para guardar. `Math.round`, no truncar: los
 * números de punto flotante de JS a veces representan "3.10" como
 * 3.0999999999999996 por dentro — truncar eso daría 309 centavos en vez
 * de 310.
 */
export function pesosToCents(pesos: number): number {
  return Math.round(pesos * 100)
}

export interface TaxSplit {
  /** Precio sin IVA. */
  netCents: number
  /** IVA contenido en `grossCents`. */
  taxCents: number
}

/**
 * Desglosa un precio QUE YA INCLUYE IVA en neto + impuesto, redondeando el
 * neto y obteniendo el impuesto por resta (nunca los dos por separado — ver
 * el comentario de cabecera). `netCents + taxCents === grossCents` siempre.
 */
export function splitTaxIncluded(grossCents: number, taxRateBp: number): TaxSplit {
  const netCents = Math.round((grossCents * 10000) / (10000 + taxRateBp))
  return { netCents, taxCents: grossCents - netCents }
}

export interface LineItem {
  /** Precio unitario CON IVA incluido, como `services.price_cents`. */
  unitPriceCents: number
  quantity: number
  /** Basis points: 1600 = 16.00% (CLAUDE.md §6.3). */
  taxRateBp: number
}

export interface LineItemsTotals {
  subtotalCents: number
  taxCents: number
  totalCents: number
}

/**
 * Suma las partidas de un carrito o ticket. El IVA de cada partida se
 * calcula por separado (`splitTaxIncluded`) y LUEGO se suma — no se calcula
 * una sola vez sobre el total, porque el redondeo por partida puede dar un
 * resultado distinto al redondeo sobre la suma (ver money.spec.ts).
 */
export function sumLineItems(items: LineItem[]): LineItemsTotals {
  return items.reduce(
    (totals, item) => {
      const lineGrossCents = item.unitPriceCents * item.quantity
      const { netCents, taxCents } = splitTaxIncluded(lineGrossCents, item.taxRateBp)
      return {
        subtotalCents: totals.subtotalCents + netCents,
        taxCents: totals.taxCents + taxCents,
        totalCents: totals.totalCents + lineGrossCents,
      }
    },
    { subtotalCents: 0, taxCents: 0, totalCents: 0 },
  )
}

/**
 * Aplica un descuento en centavos a un total. Nunca deja el resultado en
 * negativo: un descuento capturado a mano más grande que el total (error de
 * dedo, o alguien probando el límite) se recorta al total, no revienta el
 * cobro.
 */
export function applyDiscount(totalCents: number, discountCents: number): number {
  return Math.max(0, totalCents - discountCents)
}

/**
 * Convierte lo que alguien captura como monto pagado (p. ej. "$350.00",
 * "350", con o sin signo de pesos y comas de miles) a centavos enteros.
 * Una entrada que no es un número válido se trata como $0 — la UI decide
 * si eso bloquea el cobro, esta función no lanza errores por texto raro.
 */
export function parseMXNToCents(text: string): number {
  const cleaned = text.replace(/[^0-9.-]/g, '')
  const pesos = Number(cleaned)
  return Number.isFinite(pesos) ? Math.round(pesos * 100) : 0
}
