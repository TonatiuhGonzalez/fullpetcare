import { describe, expect, it } from 'vitest'

import { allocateProportionally, buildCfdi, pickPaymentForm } from './cfdi'
import type { CfdiReceiver, CfdiSaleItem } from './cfdi'

const RECEIVER: CfdiReceiver = {
  rfc: 'rucs850312ab1',
  legalName: 'Sofía Ruiz Cano',
  taxRegimeCode: '612',
  postalCode: '97000',
  cfdiUse: null,
}

const item = (over: Partial<CfdiSaleItem> = {}): CfdiSaleItem => ({
  description: 'Baño',
  quantity: 1,
  unitPriceCents: 11600,
  taxRateBp: 1600,
  satProductCode: '70122000',
  satUnitCode: 'E48',
  ...over,
})

const CASH = [{ amountCents: 100000, paymentFormCode: '01' }]

function build(
  items: CfdiSaleItem[],
  discount = 0,
  payments = CASH,
  receiver = RECEIVER,
) {
  const result = buildCfdi(items, payments, discount, receiver)
  if (!result.ok) throw new Error(result.problems.join(' | '))
  return result.body
}

// Lo que pagó el cliente: suma de partidas menos descuento (igual que la RPC de cobro).
const paid = (items: CfdiSaleItem[], discount = 0) =>
  items.reduce((s, i) => s + i.unitPriceCents * i.quantity, 0) - discount

describe('allocateProportionally', () => {
  it('reparte $10 entre tres partidas iguales sin perder ni inventar un centavo', () => {
    // Con división simple saldría 333 × 3 = 999: el descuento facturado
    // sería $0.01 menor al del ticket y el total no cuadraría.
    const parts = allocateProportionally(1000, [100, 100, 100])
    expect(parts.reduce((a, b) => a + b, 0)).toBe(1000)
    expect(parts).toEqual([334, 333, 333])
  })

  it('no reparte nada si el descuento es 0 o no hay pesos', () => {
    expect(allocateProportionally(0, [5, 5])).toEqual([0, 0])
    expect(allocateProportionally(100, [0, 0])).toEqual([0, 0])
  })
})

describe('pickPaymentForm', () => {
  it('toma la forma del pago de mayor monto en un pago mixto', () => {
    // Efectivo $200 + tarjeta de débito $800: la factura dice débito (28).
    expect(
      pickPaymentForm([
        { amountCents: 20000, paymentFormCode: '01' },
        { amountCents: 80000, paymentFormCode: '28' },
      ]),
    ).toBe('28')
  })

  it('ignora pagos sin forma (anteriores a la columna) y devuelve null si no hay ninguna', () => {
    expect(pickPaymentForm([{ amountCents: 100, paymentFormCode: null }])).toBeNull()
    expect(pickPaymentForm([])).toBeNull()
  })
})

describe('buildCfdi: importes', () => {
  it('un servicio de $116 con IVA incluido factura $100 + $16 de IVA', () => {
    // El camino feliz; si fallara, nada se podría timbrar.
    const body = build([item()])
    expect(body.concepts[0]).toMatchObject({
      netCents: 10000,
      taxCents: 1600,
      discountCents: 0,
    })
    expect(body.totals).toEqual({
      subtotalCents: 10000,
      discountCents: 0,
      taxCents: 1600,
      totalCents: 11600,
    })
  })

  it('el total del comprobante es exactamente lo que pagó el cliente (centavos que no dividen)', () => {
    // Tres partidas de precios "raros": cada IVA se redondea por separado.
    // Si el total difiere un centavo del ticket, el PAC rechaza el timbrado.
    const items = [
      item({ unitPriceCents: 9999, quantity: 3 }),
      item({ unitPriceCents: 3333, quantity: 7 }),
      item({ unitPriceCents: 101, quantity: 1 }),
    ]
    expect(build(items).totals.totalCents).toBe(paid(items))
  })

  it('un solo concepto de $1 con IVA incluido cuadra', () => {
    // Neto 0.86 + IVA 0.14: el borde más chico que se puede cobrar.
    const body = build([item({ unitPriceCents: 100 })])
    expect(body.concepts[0].netCents).toBe(86)
    expect(body.totals.totalCents).toBe(100)
  })

  it('precio 0 se factura con importes en cero', () => {
    const body = build([item({ unitPriceCents: 0 })], 0, CASH)
    expect(body.totals).toEqual({
      subtotalCents: 0,
      discountCents: 0,
      taxCents: 0,
      totalCents: 0,
    })
  })

  it('cantidad > 1: el valor unitario en millonésimas reconstruye el importe', () => {
    // 3 piezas de $100.00 con IVA: importe neto 258.62; unitario 86.206897.
    // El SAT valida cantidad × valor unitario contra el importe.
    const body = build([item({ unitPriceCents: 10000, quantity: 3 })])
    const concept = body.concepts[0]
    expect(Math.round((concept.unitPriceMicros * concept.quantity) / 10000)).toBe(
      concept.netCents,
    )
  })

  it('tasa 0 % se factura con IVA 0 y sigue siendo tasa 0 (no exento)', () => {
    // Alimento y medicina de uso animal pueden ir a tasa 0: el IVA es $0 pero
    // el concepto conserva su tasa para que el PAC lo declare como tasa 0.
    const body = build([item({ taxRateBp: 0, unitPriceCents: 5000 })])
    expect(body.concepts[0]).toMatchObject({ netCents: 5000, taxCents: 0, taxRateBp: 0 })
  })

  it('mezcla de tasas: el IVA se calcula por concepto y no sobre el total', () => {
    const items = [
      item({ unitPriceCents: 11600 }),
      item({ unitPriceCents: 5000, taxRateBp: 0 }),
    ]
    const body = build(items)
    expect(body.totals.taxCents).toBe(1600)
    expect(body.totals.totalCents).toBe(16600)
  })
})

describe('buildCfdi: descuento', () => {
  it('reparte el descuento entre conceptos y el total sigue siendo lo pagado', () => {
    // Descuento de $10.00 sobre tres conceptos iguales: el reparto de
    // centavos no puede perder ninguno, ni el IVA recalculado.
    const items = [item(), item(), item()]
    const body = build(items, 1000)
    expect(body.totals.totalCents).toBe(paid(items, 1000))
    const grossDiscount = body.concepts.reduce(
      (s, c) => s + c.discountCents + (1600 - c.taxCents),
      0,
    )
    expect(grossDiscount).toBe(1000)
  })

  it('un descuento mayor al total se rechaza', () => {
    // La base recorta a 0; aquí se rechaza para no timbrar algo ambiguo.
    const result = buildCfdi([item()], CASH, 99999, RECEIVER)
    expect(result.ok).toBe(false)
  })

  it('descuento en una venta con partidas a distinta tasa cuadra al centavo', () => {
    const items = [
      item({ unitPriceCents: 7777, quantity: 2 }),
      item({ unitPriceCents: 1234, taxRateBp: 0 }),
    ]
    expect(build(items, 555).totals.totalCents).toBe(paid(items, 555))
  })
})

describe('buildCfdi: receptor y datos faltantes', () => {
  it('normaliza el RFC a mayúsculas y usa G03 si el cliente no tiene uso de CFDI', () => {
    // Un RFC en minúsculas lo rechaza el PAC; sin uso de CFDI no hay factura.
    const body = build([item()])
    expect(body.receiver.rfc).toBe('RUCS850312AB1')
    expect(body.receiver.cfdiUse).toBe('G03')
  })

  it('lista en español cada dato del cliente que falta', () => {
    const result = buildCfdi([item()], CASH, 0, {
      rfc: null,
      legalName: ' ',
      taxRegimeCode: null,
      postalCode: '12',
      cfdiUse: null,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.problems).toEqual([
        'Falta el RFC del cliente.',
        'Falta la razón social del cliente.',
        'Falta el régimen fiscal del cliente.',
        'El código postal fiscal del cliente debe tener 5 dígitos.',
      ])
    }
  })

  it('rechaza una venta sin forma de pago registrada o sin partidas', () => {
    const noForm = buildCfdi(
      [item()],
      [{ amountCents: 11600, paymentFormCode: null }],
      0,
      RECEIVER,
    )
    expect(noForm.ok).toBe(false)
    const empty = buildCfdi([], CASH, 0, RECEIVER)
    expect(empty.ok).toBe(false)
  })
})
