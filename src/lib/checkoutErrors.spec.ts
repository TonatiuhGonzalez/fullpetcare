import { describe, expect, it } from 'vitest'

import { checkoutErrorMessage } from './checkoutErrors'

describe('checkoutErrorMessage', () => {
  it('reconoce un error de PostgREST aunque no sea una instancia de Error', () => {
    // Qué se rompería: supabase-js devuelve un objeto plano { message, code }; si se
    // exigiera `instanceof Error`, todo error de negocio caería en "revisa tu conexión",
    // que sería falso y mandaría a recepción a revisar el internet sin necesidad.
    const error = { message: 'El monto pagado no cubre el total.', code: 'P0001' }
    expect(checkoutErrorMessage(error)).toBe(
      'El monto pagado no cubre el total de la venta.',
    )
  })

  it('explica que un producto se quedó sin existencia', () => {
    // Pasa si otra caja vendió la última pieza mientras esta venta estaba abierta.
    expect(
      checkoutErrorMessage({ message: 'No hay existencia suficiente de Shampoo.' }),
    ).toMatch(/existencia suficiente/)
  })

  it('pide elegir crédito o débito cuando falta en el pago con tarjeta', () => {
    expect(
      checkoutErrorMessage({ message: 'La tarjeta debe ser de crédito o de débito.' }),
    ).toMatch(/crédito o de débito/)
  })

  it('explica que solo el efectivo puede pagar de más', () => {
    // Qué se rompería: si la base rechaza el sobrepago con tarjeta y aquí no se traduce, quien
    // cobra vería "revisa tu conexión" y reintentaría una y otra vez sin entender el motivo.
    expect(
      checkoutErrorMessage({
        message:
          'Solo se puede pagar de más en efectivo: el excedente (5000) no se puede devolver.',
      }),
    ).toMatch(/solo el efectivo puede pagar de más/i)
  })

  it('con un error desconocido o sin mensaje, cae en el genérico de conexión', () => {
    expect(checkoutErrorMessage(null)).toBe('No se pudo cobrar. Revisa tu conexión.')
    expect(checkoutErrorMessage({ message: 'algo raro' })).toBe(
      'No se pudo cobrar. Revisa tu conexión.',
    )
  })
})
