import { describe, expect, it } from 'vitest'

import {
  cashDifference,
  changeGiven,
  describeDifference,
  summarizeShift,
} from './cashCount'
import type { CashSale } from './cashCount'

const sale = (
  total: number,
  payments: CashSale['payments'],
  status: CashSale['status'] = 'paid',
): CashSale => ({
  status,
  totalCents: total,
  payments,
})
const cash = (amountCents: number) => ({ method: 'cash' as const, amountCents })
const card = (amountCents: number) => ({ method: 'card' as const, amountCents })
const transfer = (amountCents: number) => ({
  method: 'transfer_spei' as const,
  amountCents,
})

describe('changeGiven', () => {
  it('pago exacto: no hay cambio', () => {
    // Si devolviera algo aquí, el efectivo esperado quedaría de menos y el
    // corte marcaría un sobrante falso cada vez que alguien paga justo.
    expect(changeGiven(sale(35000, [cash(35000)]))).toBe(0)
  })

  it('paga con $500 una venta de $350: el cambio es $150', () => {
    // El caso de todos los días. El cobro guarda $500 (lo entregado), no el cambio.
    expect(changeGiven(sale(35000, [cash(50000)]))).toBe(15000)
  })

  it('pago solo con tarjeta que excede el total: no hay cambio en efectivo', () => {
    // De la tarjeta no se devuelve efectivo. Si se contara, el esperado bajaría
    // y la caja marcaría un sobrante que no existe.
    expect(changeGiven(sale(35000, [card(40000)]))).toBe(0)
  })

  it('pago mixto con sobrepago: el cambio sale del efectivo recibido', () => {
    // $200 efectivo + $300 tarjeta por una venta de $450: sobran $50 y se
    // devuelven de la caja.
    expect(changeGiven(sale(45000, [cash(20000), card(30000)]))).toBe(5000)
  })

  it('el cambio nunca es mayor al efectivo recibido', () => {
    // $50 en efectivo + $500 con tarjeta por $450: sobran $100 pero solo hay
    // $50 de efectivo del cual devolver. Más que eso sería inventar dinero en caja.
    expect(changeGiven(sale(45000, [cash(5000), card(50000)]))).toBe(5000)
  })

  it('una venta de $0 pagada con $0 no tiene cambio', () => {
    expect(changeGiven(sale(0, [cash(0)]))).toBe(0)
  })
})

describe('summarizeShift', () => {
  it('turno sin ventas ni movimientos: se espera solo el fondo', () => {
    // El borde más simple: un turno donde no pasó nada debe cuadrar con el fondo.
    const summary = summarizeShift({ openingFloatCents: 50000, sales: [], movements: [] })
    expect(summary.expectedCashCents).toBe(50000)
    expect(summary.collectedByMethod).toEqual({
      cash: 0,
      card: 0,
      transfer_spei: 0,
      openpay: 0,
    })
  })

  it('suma efectivo, descuenta el cambio y separa tarjeta y transferencia', () => {
    // Tres ventas: efectivo con cambio, tarjeta y transferencia. Solo el
    // efectivo (menos el cambio) entra al esperado; lo demás se reporta aparte.
    const summary = summarizeShift({
      openingFloatCents: 50000,
      sales: [
        sale(35000, [cash(50000)]),
        sale(20000, [card(20000)]),
        sale(10000, [transfer(10000)]),
      ],
      movements: [],
    })
    expect(summary.collectedByMethod).toEqual({
      cash: 35000,
      card: 20000,
      transfer_spei: 10000,
      openpay: 0,
    })
    expect(summary.changeGivenCents).toBe(15000)
    expect(summary.expectedCashCents).toBe(50000 + 35000)
  })

  it('el pago mixto con sobrepago cuenta solo el efectivo que se queda', () => {
    // $200 efectivo + $300 tarjeta por $450: del efectivo se devuelven $50,
    // quedan $150 en caja; la tarjeta se reporta completa ($300).
    const summary = summarizeShift({
      openingFloatCents: 0,
      sales: [sale(45000, [cash(20000), card(30000)])],
      movements: [],
    })
    expect(summary.collectedByMethod.cash).toBe(15000)
    expect(summary.collectedByMethod.card).toBe(30000)
    expect(summary.expectedCashCents).toBe(15000)
  })

  it('ignora ventas canceladas y abiertas', () => {
    // Una venta cancelada ya no es dinero cobrado; contarla haría que el
    // esperado fuera mayor al real y apareciera un faltante falso.
    const summary = summarizeShift({
      openingFloatCents: 10000,
      sales: [
        sale(35000, [cash(35000)], 'cancelled'),
        sale(20000, [cash(20000)], 'open'),
      ],
      movements: [],
    })
    expect(summary.expectedCashCents).toBe(10000)
  })

  it('una venta con descuento usa el total ya descontado para el cambio', () => {
    // Lista $400, descuento $50, total $350, paga con $400: el cambio es $50.
    const summary = summarizeShift({
      openingFloatCents: 0,
      sales: [sale(35000, [cash(40000)])],
      movements: [],
    })
    expect(summary.changeGivenCents).toBe(5000)
    expect(summary.expectedCashCents).toBe(35000)
  })

  it('suma ingresos y resta retiros y gastos', () => {
    // Un gasto chico con efectivo de la caja baja lo esperado; sin registrarlo
    // el corte mostraría un faltante falso cada turno.
    const summary = summarizeShift({
      openingFloatCents: 50000,
      sales: [sale(10000, [cash(10000)])],
      movements: [
        { type: 'income', amountCents: 5000 },
        { type: 'withdrawal', amountCents: 20000 },
        { type: 'expense', amountCents: 3000 },
      ],
    })
    expect(summary.incomeCents).toBe(5000)
    expect(summary.outflowCents).toBe(23000)
    expect(summary.expectedCashCents).toBe(50000 + 10000 + 5000 - 23000)
  })

  it('un retiro mayor al efectivo disponible deja el esperado en negativo, sin esconderlo', () => {
    // Es un error de captura (nadie puede sacar más de lo que hay). Se devuelve
    // el número negativo tal cual para que la pantalla lo señale, en lugar de
    // recortarlo a 0 y esconder el problema.
    const summary = summarizeShift({
      openingFloatCents: 10000,
      sales: [],
      movements: [{ type: 'withdrawal', amountCents: 30000 }],
    })
    expect(summary.expectedCashCents).toBe(-20000)
  })

  it('la suma de centavos no pierde nada con muchas ventas', () => {
    // 1 000 ventas de $0.01 con pago exacto: sin flotantes, el total es exacto.
    const sales = Array.from({ length: 1000 }, () => sale(1, [cash(1)]))
    expect(
      summarizeShift({ openingFloatCents: 0, sales, movements: [] }).expectedCashCents,
    ).toBe(1000)
  })

  it.each([
    ['un fondo con decimales', { openingFloatCents: 10.5, sales: [], movements: [] }],
    ['un fondo negativo', { openingFloatCents: -1, sales: [], movements: [] }],
    [
      'un pago con decimales',
      { openingFloatCents: 0, sales: [sale(100, [cash(100.5)])], movements: [] },
    ],
    [
      'un movimiento negativo',
      {
        openingFloatCents: 0,
        sales: [],
        movements: [{ type: 'expense' as const, amountCents: -5 }],
      },
    ],
  ])('lanza error con %s en vez de redondear en silencio', (_name, input) => {
    // Un monto que no es entero indica un bug aguas arriba (dinero en pesos con
    // decimales, §8.2). Mejor que truene a que el corte "casi" cuadre.
    expect(() => summarizeShift(input)).toThrow(RangeError)
  })
})

describe('cashDifference y describeDifference', () => {
  const fmt = (cents: number) => `$${(cents / 100).toFixed(2)}`

  it('distingue cuadra, sobra y falta', () => {
    expect(cashDifference(85000, 85000)).toEqual({ differenceCents: 0, kind: 'exact' })
    expect(cashDifference(86000, 85000)).toEqual({
      differenceCents: 1000,
      kind: 'surplus',
    })
    expect(cashDifference(84000, 85000)).toEqual({
      differenceCents: -1000,
      kind: 'shortage',
    })
  })

  it('cuenta $0 con esperado positivo es un faltante completo', () => {
    // Borde: si alguien cierra sin contar nada, la diferencia es todo el esperado.
    expect(cashDifference(0, 85000).differenceCents).toBe(-85000)
  })

  it('redacta el resultado en español sencillo', () => {
    // La pantalla de cierre muestra esto: sin jerga y con el monto en positivo.
    expect(describeDifference(cashDifference(85000, 85000), fmt)).toBe('La caja cuadra.')
    expect(describeDifference(cashDifference(86050, 85000), fmt)).toBe('Sobran $10.50.')
    expect(describeDifference(cashDifference(84000, 85000), fmt)).toBe('Faltan $10.00.')
  })

  it('rechaza un conteo con decimales', () => {
    expect(() => cashDifference(100.5, 100)).toThrow(RangeError)
  })
})
