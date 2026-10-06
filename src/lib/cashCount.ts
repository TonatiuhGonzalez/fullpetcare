// Efectivo que debe haber en la caja al cerrar un turno (fase 12, tarea 12.2 /
// HMH Four #2072). Función pura: entran el fondo, las ventas con sus pagos y los
// movimientos de caja; sale cuánto efectivo se espera y cuánto sobra o falta.
// La RPC de cierre (12.6) repite esta MISMA regla en SQL, y un test compara las
// dos con las mismas entradas (mismo patrón que lib/cfdi.ts y su copia).
//
// Por qué el cambio se DERIVA y no está guardado: el cobro acepta pagos que suman
// más que el total (se paga con $500 una venta de $350) y registra el monto
// entregado ($500), no el cambio. El cambio es `pagado − total` de esa venta, y
// solo puede salir de la caja si hubo efectivo: nunca más que el efectivo
// recibido en esa venta. Si un cliente paga con tarjeta de más, esa diferencia
// no sale del cajón (no hay cambio en efectivo que dar).
//
// Todo en centavos enteros (CLAUDE.md §8.2). Un monto no entero o negativo es un
// error de programación, no un dato raro: se lanza en vez de redondear en
// silencio, porque un corte que "casi" cuadra es peor que uno que truena.

export type CashPaymentMethod = 'cash' | 'card' | 'transfer_spei' | 'openpay'
export type CashMovementType = 'withdrawal' | 'expense' | 'income'

export interface CashSalePayment {
  method: CashPaymentMethod
  /** Monto ENTREGADO por el cliente (puede exceder el total de la venta). */
  amountCents: number
}

export interface CashSale {
  /** Solo las ventas pagadas cuentan; abiertas y canceladas se ignoran. */
  status: 'open' | 'paid' | 'cancelled'
  /** Total de la venta (ya con descuento), sin contar el cambio. */
  totalCents: number
  payments: CashSalePayment[]
}

export interface CashMovement {
  type: CashMovementType
  /** Siempre positivo; el tipo decide si entra o sale. */
  amountCents: number
}

export interface ShiftCashInput {
  openingFloatCents: number
  sales: CashSale[]
  movements: CashMovement[]
}

export interface ShiftCashSummary {
  /** Lo cobrado por método, ya sin el cambio (en efectivo: lo que se queda en caja). */
  collectedByMethod: Record<CashPaymentMethod, number>
  /** Cambio entregado en efectivo en todo el turno. */
  changeGivenCents: number
  incomeCents: number
  /** Retiros + gastos. */
  outflowCents: number
  /** Efectivo que debería haber al cerrar. Puede ser negativo si hubo un error de captura. */
  expectedCashCents: number
}

function assertCents(value: number, what: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(
      `${what} debe ser un entero en centavos mayor o igual a 0 (llegó ${value}).`,
    )
  }
}

/**
 * Cambio que se entregó en efectivo en UNA venta: lo pagado de más, limitado al
 * efectivo recibido (solo con efectivo se da cambio).
 */
export function changeGiven(sale: Pick<CashSale, 'totalCents' | 'payments'>): number {
  assertCents(sale.totalCents, 'El total de la venta')
  let paid = 0
  let cashReceived = 0
  for (const payment of sale.payments) {
    assertCents(payment.amountCents, 'El monto de un pago')
    paid += payment.amountCents
    if (payment.method === 'cash') cashReceived += payment.amountCents
  }
  return Math.min(cashReceived, Math.max(0, paid - sale.totalCents))
}

/** Resumen del turno: lo cobrado por método, el cambio y el efectivo esperado. */
export function summarizeShift(input: ShiftCashInput): ShiftCashSummary {
  assertCents(input.openingFloatCents, 'El fondo inicial')

  const collectedByMethod: Record<CashPaymentMethod, number> = {
    cash: 0,
    card: 0,
    transfer_spei: 0,
    openpay: 0,
  }
  let changeGivenCents = 0

  for (const sale of input.sales) {
    if (sale.status !== 'paid') continue
    const change = changeGiven(sale)
    changeGivenCents += change
    for (const payment of sale.payments) {
      collectedByMethod[payment.method] += payment.amountCents
    }
    // El cambio sale del efectivo: lo que se queda en caja es lo recibido menos lo devuelto.
    collectedByMethod.cash -= change
  }

  let incomeCents = 0
  let outflowCents = 0
  for (const movement of input.movements) {
    assertCents(movement.amountCents, 'El monto de un movimiento de caja')
    if (movement.type === 'income') incomeCents += movement.amountCents
    else outflowCents += movement.amountCents
  }

  return {
    collectedByMethod,
    changeGivenCents,
    incomeCents,
    outflowCents,
    expectedCashCents:
      input.openingFloatCents + collectedByMethod.cash + incomeCents - outflowCents,
  }
}

export type DifferenceKind = 'exact' | 'surplus' | 'shortage'

export interface CashDifference {
  /** contado − esperado: positivo = sobra, negativo = falta. */
  differenceCents: number
  kind: DifferenceKind
}

/** Diferencia del conteo contra lo esperado. */
export function cashDifference(
  countedCents: number,
  expectedCashCents: number,
): CashDifference {
  assertCents(countedCents, 'El efectivo contado')
  const differenceCents = countedCents - expectedCashCents
  return {
    differenceCents,
    kind: differenceCents === 0 ? 'exact' : differenceCents > 0 ? 'surplus' : 'shortage',
  }
}

/** Texto para la pantalla de cierre, sin jerga ("Sobran" / "Faltan"). */
export function describeDifference(
  difference: CashDifference,
  format: (cents: number) => string,
): string {
  if (difference.kind === 'exact') return 'La caja cuadra.'
  const amount = format(Math.abs(difference.differenceCents))
  return difference.kind === 'surplus' ? `Sobran ${amount}.` : `Faltan ${amount}.`
}
