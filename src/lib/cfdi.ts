// Armado del comprobante fiscal (CFDI 4.0) de una venta (fase 11, tarea 11.16).
// Función pura: entra la venta ya cobrada (partidas, pagos, cliente), sale el
// cuerpo de la factura en centavos. No habla con el PAC: el adaptador de la Edge
// Function convierte este cuerpo al formato del proveedor. Así la parte difícil
// (que los importes cuadren al centavo) se prueba aquí sin red.
//
// El riesgo que cubre: el desglose de IVA hacia atrás (CLAUDE.md §8.2) y el
// descuento deben dar EXACTAMENTE el total que pagó el cliente. Si la suma de
// los conceptos difiere un centavo del ticket, el PAC rechaza el timbrado.
import { splitTaxIncluded } from './money'
import { isValidPostalCode, isValidRFC } from './validation'

export interface CfdiSaleItem {
  description: string
  quantity: number
  /** Precio unitario CON IVA incluido, como en el ticket. */
  unitPriceCents: number
  taxRateBp: number
  /** Claves del SAT del servicio o producto (ver `services` y `products`). */
  satProductCode: string
  satUnitCode: string
}

export interface CfdiPayment {
  amountCents: number
  /** c_FormaPago guardada al cobrar (`payments.payment_form_code`). */
  paymentFormCode: string | null
}

export interface CfdiReceiver {
  rfc: string | null
  legalName: string | null
  taxRegimeCode: string | null
  postalCode: string | null
  cfdiUse: string | null
}

export interface CfdiConcept {
  description: string
  quantity: number
  satProductCode: string
  satUnitCode: string
  /** Importe del concepto SIN IVA y antes del descuento (ValorUnitario × Cantidad). */
  netCents: number
  /** Valor unitario SIN IVA en millonésimas de peso (el SAT permite 6 decimales). */
  unitPriceMicros: number
  /** Descuento sobre el importe sin IVA. */
  discountCents: number
  /** Base del IVA: netCents - discountCents. */
  taxBaseCents: number
  /** Tasa en basis points (1600 = 16 %). 0 = tasa 0 %, NO exento. */
  taxRateBp: number
  taxCents: number
}

export interface CfdiBody {
  receiver: {
    rfc: string
    legalName: string
    taxRegimeCode: string
    postalCode: string
    cfdiUse: string
  }
  paymentFormCode: string
  /** PUE: el cobro siempre es en una sola exhibición (CLAUDE.md §1). */
  paymentMethodCode: 'PUE'
  concepts: CfdiConcept[]
  /** Subtotal = suma de importes sin IVA; total = subtotal - descuento + IVA. */
  totals: {
    subtotalCents: number
    discountCents: number
    taxCents: number
    totalCents: number
  }
}

export type CfdiResult = { ok: true; body: CfdiBody } | { ok: false; problems: string[] }

/** Uso de CFDI por defecto cuando el cliente no tiene uno: gastos en general. */
export const DEFAULT_CFDI_USE = 'G03'

/**
 * Reparte `totalCents` entre partidas en proporción a `weights` (método del
 * mayor residuo): cada parte es un entero y las partes suman EXACTO el total.
 * Sin esto, repartir $10 entre tres conceptos iguales daría 3.33 × 3 = 9.99.
 */
export function allocateProportionally(totalCents: number, weights: number[]): number[] {
  const weightSum = weights.reduce((a, b) => a + b, 0)
  if (weightSum === 0 || totalCents === 0) return weights.map(() => 0)

  const exact = weights.map((w) => (totalCents * w) / weightSum)
  const parts = exact.map(Math.floor)
  let remainder = totalCents - parts.reduce((a, b) => a + b, 0)

  // Los centavos que sobran van a quienes perdieron más al truncar (el empate
  // lo gana la partida de más arriba, para que el resultado sea determinista).
  const order = exact
    .map((value, index) => ({ index, lost: value - Math.floor(value) }))
    .sort((a, b) => b.lost - a.lost || a.index - b.index)
  for (const { index } of order) {
    if (remainder === 0) break
    parts[index] += 1
    remainder -= 1
  }
  return parts
}

/**
 * Forma de pago del comprobante: la del pago de mayor monto (si empatan, la del
 * primero). Es una simplificación acordada en la fase y PENDIENTE de confirmar
 * con un contador: el SAT permite "99 Por definir" o desglosar los pagos.
 */
export function pickPaymentForm(payments: CfdiPayment[]): string | null {
  let best: CfdiPayment | null = null
  for (const payment of payments) {
    if (!payment.paymentFormCode) continue
    if (!best || payment.amountCents > best.amountCents) best = payment
  }
  return best?.paymentFormCode ?? null
}

/**
 * Arma el cuerpo del CFDI de una venta. `discountCents` es el descuento de la
 * venta completa (en pesos con IVA, como se captura al cobrar): se reparte entre
 * los conceptos en proporción a su importe y el IVA se recalcula sobre lo que
 * realmente pagó el cliente por cada uno.
 *
 * Devuelve `problems` en español (y no lanza) para que la pantalla le diga a
 * quien factura qué dato del cliente falta.
 */
export function buildCfdi(
  items: CfdiSaleItem[],
  payments: CfdiPayment[],
  discountCents: number,
  receiver: CfdiReceiver,
): CfdiResult {
  const problems: string[] = []

  const rfc = receiver.rfc?.trim().toUpperCase() ?? ''
  if (!rfc) problems.push('Falta el RFC del cliente.')
  else if (!isValidRFC(rfc))
    problems.push('El RFC del cliente no tiene un formato válido.')
  if (!receiver.legalName?.trim()) problems.push('Falta la razón social del cliente.')
  if (!receiver.taxRegimeCode) problems.push('Falta el régimen fiscal del cliente.')
  const postalCode = receiver.postalCode?.trim() ?? ''
  if (!postalCode) problems.push('Falta el código postal fiscal del cliente.')
  else if (!isValidPostalCode(postalCode)) {
    problems.push('El código postal fiscal del cliente debe tener 5 dígitos.')
  }

  if (items.length === 0) problems.push('La venta no tiene partidas que facturar.')
  const paymentFormCode = pickPaymentForm(payments)
  if (!paymentFormCode) problems.push('Falta la forma de pago de la venta.')

  const grossLines = items.map((item) => item.unitPriceCents * item.quantity)
  const grossTotal = grossLines.reduce((a, b) => a + b, 0)
  if (discountCents < 0 || discountCents > grossTotal) {
    problems.push('El descuento de la venta no es válido.')
  }

  if (problems.length > 0) return { ok: false, problems }

  // Descuento (con IVA) que le toca a cada partida, y su efecto en neto e IVA.
  const grossDiscounts = allocateProportionally(discountCents, grossLines)
  const concepts: CfdiConcept[] = items.map((item, i) => {
    const before = splitTaxIncluded(grossLines[i], item.taxRateBp)
    const after = splitTaxIncluded(grossLines[i] - grossDiscounts[i], item.taxRateBp)
    return {
      description: item.description,
      quantity: item.quantity,
      satProductCode: item.satProductCode,
      satUnitCode: item.satUnitCode,
      netCents: before.netCents,
      unitPriceMicros: Math.round((before.netCents * 10000) / item.quantity),
      discountCents: before.netCents - after.netCents,
      taxBaseCents: after.netCents,
      taxRateBp: item.taxRateBp,
      taxCents: after.taxCents,
    }
  })

  const subtotalCents = concepts.reduce((sum, c) => sum + c.netCents, 0)
  const discountTotal = concepts.reduce((sum, c) => sum + c.discountCents, 0)
  const taxCents = concepts.reduce((sum, c) => sum + c.taxCents, 0)

  return {
    ok: true,
    body: {
      receiver: {
        rfc,
        legalName: receiver.legalName!.trim(),
        taxRegimeCode: receiver.taxRegimeCode!,
        postalCode,
        cfdiUse: receiver.cfdiUse || DEFAULT_CFDI_USE,
      },
      paymentFormCode: paymentFormCode!,
      paymentMethodCode: 'PUE',
      concepts,
      totals: {
        subtotalCents,
        discountCents: discountTotal,
        taxCents,
        totalCents: subtotalCents - discountTotal + taxCents,
      },
    },
  }
}
