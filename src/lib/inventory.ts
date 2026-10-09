// Reglas de inventario (fase 11, CLAUDE.md §9: la lógica que se pueda expresar
// como función pura va en lib/). Entra un número, sale un número: sin red, sin
// Supabase. Son las MISMAS reglas que aplica la base (migración
// stock_movements.sql); aquí viven para que la pantalla avise ANTES de enviar.
//
// Todo es entero (decisión #6 de la fase): lo suelto se maneja como presentación.
import { isValidSatProductCode, isValidSatUnitCode } from './validation'

/** Tipos de movimiento que una persona puede registrar a mano. */
export type ManualMovementType = 'purchase' | 'adjustment' | 'loss'

export type StockStatus = 'ok' | 'low' | 'out'

/**
 * Existencia a partir de movimientos: la suma de sus cantidades con signo.
 * Sin movimientos es 0, nunca NaN ni undefined (si no, la pantalla pintaría "NaN").
 */
export function computeStock(movements: { quantity: number }[]): number {
  return movements.reduce((sum, m) => sum + m.quantity, 0)
}

/**
 * Cómo se ve un producto en la lista:
 *  - 'out': existencia 0 (o menos) → "Sin inventario", y no se puede vender.
 *  - 'low': queda poco, `existencia <= min_stock` (decisión #2) → aviso.
 *  - 'ok': todo bien.
 * 'out' gana sobre 'low'. Con `minStock = 0` nunca hay aviso de poco: el negocio
 * dijo que no quiere mínimo, así que solo se avisa al llegar a 0.
 */
export function stockStatus(stock: number, minStock: number): StockStatus {
  if (stock <= 0) return 'out'
  if (stock <= minStock) return 'low'
  return 'ok'
}

export const STOCK_STATUS_LABEL: Record<StockStatus, string> = {
  ok: 'Disponible',
  low: 'Stock bajo',
  out: 'Sin inventario',
}

/** Cantidad válida para capturar: entero mayor a 0 (el signo lo pone el tipo de movimiento). */
export function isValidQuantity(value: number): boolean {
  return Number.isInteger(value) && value > 0
}

/**
 * ¿Se puede sacar `quantity` piezas? Es la regla de "con existencia 0 no se
 * vende ni se consume": pide una cantidad válida y que alcance.
 */
export function canRemove(stock: number, quantity: number): boolean {
  return isValidQuantity(quantity) && stock >= quantity
}

/** Cantidad con signo para guardar: compra entra, merma sale, ajuste según `direction`. */
export function signedQuantity(
  type: ManualMovementType,
  quantity: number,
  direction: 'in' | 'out' = 'in',
): number {
  if (type === 'purchase') return quantity
  if (type === 'loss') return -quantity
  return direction === 'in' ? quantity : -quantity
}

export interface MovementInput {
  type: ManualMovementType
  quantity: number
  direction?: 'in' | 'out'
  reason?: string
  /** Existencia actual de ese producto en esa sucursal. */
  currentStock: number
}

/**
 * Valida lo que captura el usuario. Regresa el mensaje (en español, para
 * mostrarlo tal cual) o `null` si está bien. Los mensajes de abajo son los que
 * ve la persona, por eso no mencionan columnas ni códigos.
 */
export function validateMovement(input: MovementInput): string | null {
  if (!isValidQuantity(input.quantity)) {
    return 'La cantidad debe ser un número entero mayor a 0.'
  }
  if (input.type !== 'purchase' && !(input.reason ?? '').trim()) {
    return 'Escribe el motivo.'
  }
  const delta = signedQuantity(input.type, input.quantity, input.direction)
  if (delta < 0 && !canRemove(input.currentStock, -delta)) {
    return `No hay existencia suficiente: hay ${input.currentStock}.`
  }
  return null
}

export interface ProductInput {
  name: string
  priceCents: number
  /** Opcional: no todos los negocios llevan el costo. */
  costCents: number | null
  minStock: number
  satProductCode: string
  satUnitCode: string
  /** Categoría para agrupar el punto de venta; null = sin categoría. */
  categoryId: string | null
}

/**
 * Valida el formulario de producto. Regresa el primer mensaje (en español) o
 * `null`. Dinero y mínimo son enteros (CLAUDE.md §8.2): el precio ya viene en
 * centavos, convertido con `pesosToCents()` antes de llegar aquí.
 */
export function validateProduct(input: ProductInput): string | null {
  if (!input.name.trim()) return 'Escribe el nombre del producto.'
  if (!Number.isInteger(input.priceCents) || input.priceCents < 0) {
    return 'El precio debe ser 0 o mayor.'
  }
  if (
    input.costCents !== null &&
    (!Number.isInteger(input.costCents) || input.costCents < 0)
  ) {
    return 'El costo debe ser 0 o mayor.'
  }
  if (!Number.isInteger(input.minStock) || input.minStock < 0) {
    return 'El mínimo debe ser un número entero, 0 o mayor.'
  }
  if (!isValidSatProductCode(input.satProductCode)) {
    return 'La clave de producto del SAT debe tener 8 dígitos.'
  }
  if (!isValidSatUnitCode(input.satUnitCode)) {
    return 'La clave de unidad del SAT debe tener 2 o 3 caracteres.'
  }
  return null
}
