// Cambio de un cobro (efectivo recibido de más). Funciones puras: entra el total y los pagos,
// sale cuánto se devuelve. Sin red. La regla es la MISMA de Caja (lib/cashCount.ts#changeGiven):
// solo con efectivo se da cambio, y nunca más del efectivo recibido; este archivo solo agrega
// lo que la pantalla de cobro necesita, que es detectar el sobrepago que NO se puede devolver.
import { changeGiven, type CashSalePayment } from './cashCount'

export interface PaymentChange {
  /** Lo que se le devuelve al cliente, en efectivo. 0 si no pagó de más. */
  changeCents: number
  /**
   * Lo pagado de más que no se puede devolver porque no vino en efectivo (p. ej. una tarjeta
   * por $500 en una cuenta de $300): no se da cambio de una tarjeta. Debe ser 0 para cobrar.
   */
  unpayableExcessCents: number
}

export function paymentChange(
  totalCents: number,
  payments: CashSalePayment[],
): PaymentChange {
  const paidCents = payments.reduce((sum, p) => sum + p.amountCents, 0)
  const excessCents = Math.max(0, paidCents - totalCents)
  const changeCents = changeGiven({ totalCents, payments })
  return { changeCents, unpayableExcessCents: excessCents - changeCents }
}
