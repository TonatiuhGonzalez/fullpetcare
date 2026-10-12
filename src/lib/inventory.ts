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

// ── Tabla de Inventario (Correcciones 1, C1.17) ──────────────────────────────

/** Etiqueta de la categoría cuando el producto no tiene (o su categoría ya no existe). */
export const NO_CATEGORY_LABEL = 'Sin categoría'

/** Lo mínimo que necesita la tabla de un renglón del store (sin importar el store: lib/ es puro). */
export interface InventoryRowSource {
  product: {
    id: string
    name: string
    sku: string | null
    price_cents: number
    is_active: boolean
    category_id: string | null
  }
  stock: number
  status: StockStatus
}

/** Un renglón plano de la tabla: cada columna ordenable es un campo propio. */
export interface InventoryTableRow<T extends InventoryRowSource = InventoryRowSource> {
  id: string
  name: string
  /** Clave (sku); `null` si el producto no tiene. */
  sku: string | null
  /** Nombre de la categoría; `null` = sin categoría (se muestra como `NO_CATEGORY_LABEL`). */
  categoryName: string | null
  priceCents: number
  stock: number
  status: StockStatus
  isActive: boolean
  /** El renglón original, para que los botones de acción reciban lo que ya esperaban. */
  source: T
}

/**
 * Arma los renglones de la tabla. La categoría se resuelve por id; si el producto no
 * tiene categoría, o apunta a una que ya no está en la lista, queda en `null`.
 */
export function buildInventoryTableRows<T extends InventoryRowSource>(
  rows: T[],
  categories: { id: string; name: string }[],
): InventoryTableRow<T>[] {
  const nameById = new Map(categories.map((c) => [c.id, c.name]))
  return rows.map((row) => ({
    id: row.product.id,
    name: row.product.name,
    sku: row.product.sku,
    categoryName: row.product.category_id
      ? (nameById.get(row.product.category_id) ?? null)
      : null,
    priceCents: row.product.price_cents,
    stock: row.stock,
    status: row.status,
    isActive: row.product.is_active,
    source: row,
  }))
}

/**
 * Compara textos para ordenar: sin distinguir mayúsculas ni acentos ("Álamo" junto a
 * "alamo"), en orden de español. Los vacíos (`null` o "") van SIEMPRE al final al ordenar
 * ascendente (y al inicio al descendente, porque Vuetify solo invierte el signo): así
 * "Sin categoría" y "sin clave" no estorban arriba de la lista.
 */
export function compareOptionalText(a: string | null, b: string | null): number {
  const left = (a ?? '').trim()
  const right = (b ?? '').trim()
  if (!left && !right) return 0
  if (!left) return 1
  if (!right) return -1
  return left.localeCompare(right, 'es', { sensitivity: 'base' })
}

/** Activo/inactivo para ordenar: los inactivos primero al ascender (false < true). */
export function compareBoolean(a: boolean, b: boolean): number {
  return Number(a) - Number(b)
}
