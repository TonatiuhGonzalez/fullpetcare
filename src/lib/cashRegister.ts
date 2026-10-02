// Validación de lo que se captura en la pantalla de Caja (fase 12, tarea 12.11 /
// HMH Four #2077). Funciones puras: texto en pesos → centavos, y mensajes en
// español sin jerga. La base repite estas reglas (checks y RPC): esto solo evita
// enviar lo que se sabe que va a fallar y le dice a la persona qué corregir.

/** Tope razonable para un monto capturado a mano: $1,000,000.00. Atrapa un cero de más. */
export const MAX_CASH_INPUT_CENTS = 100_000_000

/**
 * Convierte lo que se escribe ("$1,250.50", "350", "0.5") a centavos enteros.
 * Devuelve null si no es un monto válido: vacío, con letras, negativo o con más
 * de dos decimales. A diferencia de `parseMXNToCents` (money.ts, que trata lo raro
 * como $0), aquí un dato dudoso NO se acepta: un fondo o un conteo capturado mal
 * descuadra el corte.
 */
export function parsePesosInput(text: string): number | null {
  const cleaned = text.replace(/[$,\s]/g, '')
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null
  const [whole, fraction = ''] = cleaned.split('.')
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
  return Number.isSafeInteger(cents) ? cents : null
}

export interface AmountCheck {
  cents: number | null
  error: string | null
}

function checkAmount(
  text: string,
  what: string,
  { allowZero }: { allowZero: boolean },
): AmountCheck {
  if (text.trim() === '') return { cents: null, error: `Escribe ${what}.` }
  const cents = parsePesosInput(text)
  if (cents === null) {
    return {
      cents: null,
      error: `${capitalize(what)} no es válido. Usa solo números, con hasta dos decimales.`,
    }
  }
  if (!allowZero && cents === 0)
    return { cents: null, error: `${capitalize(what)} debe ser mayor a cero.` }
  if (cents > MAX_CASH_INPUT_CENTS) {
    return {
      cents: null,
      error: `${capitalize(what)} parece demasiado grande. Revisa los ceros.`,
    }
  }
  return { cents, error: null }
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/** El fondo con el que se abre la caja puede ser $0 (se abre sin efectivo). */
export const checkOpeningFloat = (text: string) =>
  checkAmount(text, 'el fondo inicial', { allowZero: true })

/** El conteo al cerrar puede ser $0 (una caja vacía es un resultado posible). */
export const checkCountedCash = (text: string) =>
  checkAmount(text, 'el efectivo contado', { allowZero: true })

/** Un movimiento de caja siempre mueve dinero: no puede ser $0. */
export const checkMovementAmount = (text: string) =>
  checkAmount(text, 'el monto', { allowZero: false })

export type CashMovementKind = 'withdrawal' | 'expense' | 'income'

export const MOVEMENT_LABELS: Record<
  CashMovementKind,
  { title: string; sign: '+' | '−'; help: string }
> = {
  withdrawal: {
    title: 'Retiro',
    sign: '−',
    help: 'Sacas dinero de la caja para guardarlo o llevarlo a otro lugar.',
  },
  expense: {
    title: 'Gasto',
    sign: '−',
    help: 'Pagas algo con efectivo de la caja (hielo, insumos de limpieza, un mandado).',
  },
  income: {
    title: 'Ingreso',
    sign: '+',
    help: 'Metes dinero a la caja que no viene de una venta (por ejemplo, cambio que te dan).',
  },
}

/** Validación del formulario de un movimiento: monto y motivo obligatorios. */
export function checkMovement(
  amountText: string,
  reason: string,
): { cents: number | null; error: string | null } {
  const amount = checkMovementAmount(amountText)
  if (amount.error) return amount
  if (reason.trim() === '')
    return { cents: null, error: 'Escribe el motivo del movimiento.' }
  return amount
}
