import { describe, expect, it } from 'vitest'

import { paymentChange } from './paymentChange'

describe('paymentChange', () => {
  it('con efectivo exacto no hay cambio', () => {
    // Qué se rompería: la pantalla pediría devolver $0.00 o, peor, un cambio fantasma.
    expect(paymentChange(30000, [{ method: 'cash', amountCents: 30000 }])).toEqual({
      changeCents: 0,
      unpayableExcessCents: 0,
    })
  })

  it('con efectivo de más devuelve la diferencia', () => {
    // El caso del pedido: cuenta de $300 pagada con $500 → $200 de cambio.
    expect(paymentChange(30000, [{ method: 'cash', amountCents: 50000 }])).toEqual({
      changeCents: 20000,
      unpayableExcessCents: 0,
    })
  })

  it('con pago parcial no hay cambio ni sobrepago', () => {
    // Qué se rompería: mostrar cambio negativo mientras todavía falta dinero.
    expect(paymentChange(30000, [{ method: 'cash', amountCents: 10000 }])).toEqual({
      changeCents: 0,
      unpayableExcessCents: 0,
    })
  })

  it('una tarjeta por más del total es un sobrepago que no se puede devolver', () => {
    // Qué se rompería: se cobraría de más a una tarjeta y en Caja no habría efectivo de
    // dónde devolver la diferencia.
    expect(paymentChange(30000, [{ method: 'card', amountCents: 50000 }])).toEqual({
      changeCents: 0,
      unpayableExcessCents: 20000,
    })
  })

  it('tarjeta por el total y efectivo extra: solo se devuelve el efectivo', () => {
    // $300 con tarjeta cubren la cuenta; los $100 en efectivo sobran y se devuelven completos.
    expect(
      paymentChange(30000, [
        { method: 'card', amountCents: 30000 },
        { method: 'cash', amountCents: 10000 },
      ]),
    ).toEqual({ changeCents: 10000, unpayableExcessCents: 0 })
  })

  it('el cambio nunca supera el efectivo recibido', () => {
    // $100 en efectivo + $300 con tarjeta en una cuenta de $300: sobran $100 y hay $100 en
    // efectivo, se devuelven. Con $50 en efectivo, los otros $50 no tienen de dónde salir.
    expect(
      paymentChange(30000, [
        { method: 'cash', amountCents: 5000 },
        { method: 'card', amountCents: 30000 },
      ]),
    ).toEqual({ changeCents: 5000, unpayableExcessCents: 0 })
    expect(
      paymentChange(30000, [
        { method: 'cash', amountCents: 5000 },
        { method: 'card', amountCents: 35000 },
      ]),
    ).toEqual({ changeCents: 5000, unpayableExcessCents: 5000 })
  })

  it('sin pagos no hay nada', () => {
    expect(paymentChange(30000, [])).toEqual({ changeCents: 0, unpayableExcessCents: 0 })
  })
})
