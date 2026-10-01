// Estado de la pantalla de Inventario: los productos del negocio con su
// existencia en la sucursal activa. Junta dos consultas (catálogo + vista
// product_stock) y deja que lib/inventory.ts decida el estado de cada una
// (disponible / stock bajo / sin inventario).
import { computed, ref } from 'vue'
import { defineStore } from 'pinia'

import * as inventoryService from '@/services/inventory'
import * as productsService from '@/services/products'
import type { Product } from '@/services/products'
import { stockStatus, validateMovement, type ManualMovementType, type StockStatus } from '@/lib/inventory'
import { useSessionStore } from './session'

export interface InventoryRow {
  product: Product
  stock: number
  status: StockStatus
}

export interface MovementRequest {
  productId: string
  type: ManualMovementType
  quantity: number
  direction?: 'in' | 'out'
  reason?: string
}

export const useInventoryStore = defineStore('inventory', () => {
  const rows = ref<InventoryRow[]>([])
  const status = ref<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const errorMessage = ref<string | null>(null)

  /** Productos que piden atención: sin inventario o con stock bajo. */
  const alertRows = computed(() => rows.value.filter((r) => r.product.is_active && r.status !== 'ok'))

  async function load(): Promise<void> {
    const session = useSessionStore()
    if (!session.activeTenantId || !session.activeBranchId) return

    status.value = 'loading'
    errorMessage.value = null
    try {
      const [products, stock] = await Promise.all([
        productsService.list(session.activeTenantId),
        inventoryService.listStock(session.activeTenantId, session.activeBranchId),
      ])
      const stockByProduct = new Map(stock.map((s) => [s.product_id, s.stock]))
      rows.value = products.map((product) => {
        // Sin fila en la vista = sin movimientos = 0 (nunca undefined).
        const units = stockByProduct.get(product.id) ?? 0
        return { product, stock: units, status: stockStatus(units, product.min_stock) }
      })
      status.value = 'ready'
    } catch {
      status.value = 'error'
      errorMessage.value = 'No se pudo cargar el inventario. Revisa tu conexión.'
    }
  }

  /**
   * Registra una compra, ajuste o merma y recarga. Devuelve el mensaje de error
   * (listo para mostrar) o `null` si salió bien. Valida antes con las mismas
   * reglas que la base para no enviar lo que se sabe que va a fallar.
   */
  async function registerMovement(request: MovementRequest): Promise<string | null> {
    const session = useSessionStore()
    if (!session.activeTenantId || !session.activeBranchId || !session.user) {
      return 'No se pudo registrar el movimiento. Inicia sesión de nuevo.'
    }
    const current = rows.value.find((r) => r.product.id === request.productId)
    const validationError = validateMovement({ ...request, currentStock: current?.stock ?? 0 })
    if (validationError) return validationError

    try {
      await inventoryService.registerMovement({
        ...request,
        tenantId: session.activeTenantId,
        branchId: session.activeBranchId,
        userId: session.user.id,
      })
    } catch {
      return 'No se pudo registrar el movimiento. Revisa tu conexión.'
    }
    await load()
    return null
  }

  function reset(): void {
    rows.value = []
    status.value = 'idle'
    errorMessage.value = null
  }

  return { rows, status, errorMessage, alertRows, load, registerMovement, reset }
})
