// Estado de la pantalla de Inventario: los productos del negocio con su
// existencia en la sucursal activa. Junta dos consultas (catálogo + vista
// product_stock) y deja que lib/inventory.ts decida el estado de cada una
// (disponible / stock bajo / sin inventario).
import { computed, ref } from 'vue'
import { defineStore } from 'pinia'

import * as inventoryService from '@/services/inventory'
import * as categoriesService from '@/services/productCategories'
import type { ProductCategory } from '@/services/productCategories'
import * as productsService from '@/services/products'
import type { Product } from '@/services/products'
import {
  stockStatus,
  validateMovement,
  validateProduct,
  type ManualMovementType,
  type ProductInput,
  type StockStatus,
} from '@/lib/inventory'
import { validateCategory } from '@/lib/productCategories'
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
  /** Categorías del negocio, activas e inactivas (el diálogo de categorías las muestra todas). */
  const categories = ref<ProductCategory[]>([])
  const status = ref<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const errorMessage = ref<string | null>(null)

  /** Productos que piden atención: sin inventario o con stock bajo. */
  const alertRows = computed(() =>
    rows.value.filter((r) => r.product.is_active && r.status !== 'ok'),
  )

  async function load(): Promise<void> {
    const session = useSessionStore()
    if (!session.activeTenantId || !session.activeBranchId) return

    status.value = 'loading'
    errorMessage.value = null
    try {
      const [products, stock, allCategories] = await Promise.all([
        productsService.list(session.activeTenantId),
        inventoryService.listStock(session.activeTenantId, session.activeBranchId),
        categoriesService.list(session.activeTenantId),
      ])
      categories.value = allCategories
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
    const validationError = validateMovement({
      ...request,
      currentStock: current?.stock ?? 0,
    })
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

  /**
   * Alta (`productId` ausente) o edición de un producto, y recarga. Devuelve el
   * mensaje de error listo para mostrar o `null` si salió bien. El IVA no se
   * captura: el alta usa el 16 % de la base y la edición no lo toca.
   */
  async function saveProduct(
    input: ProductInput,
    productId?: string,
  ): Promise<string | null> {
    const session = useSessionStore()
    if (!session.activeTenantId)
      return 'No se pudo guardar el producto. Inicia sesión de nuevo.'
    const validationError = validateProduct(input)
    if (validationError) return validationError

    const fields = {
      name: input.name.trim(),
      price_cents: input.priceCents,
      cost_cents: input.costCents,
      min_stock: input.minStock,
      sat_product_code: input.satProductCode.trim(),
      sat_unit_code: input.satUnitCode.trim().toUpperCase(),
      category_id: input.categoryId,
    }
    try {
      if (productId) await productsService.update(productId, fields)
      else await productsService.create({ ...fields, tenant_id: session.activeTenantId })
    } catch {
      return 'No se pudo guardar el producto. Revisa tu conexión.'
    }
    await load()
    return null
  }

  /** Desactiva o reactiva un producto (no se borra: conserva su historial). */
  async function setProductActive(
    productId: string,
    isActive: boolean,
  ): Promise<string | null> {
    try {
      await productsService.setActive(productId, isActive)
    } catch {
      return `No se pudo ${isActive ? 'activar' : 'desactivar'} el producto. Revisa tu conexión.`
    }
    const row = rows.value.find((r) => r.product.id === productId)
    if (row) row.product.is_active = isActive
    return null
  }

  /**
   * Alta (`categoryId` ausente) o edición de una categoría, y recarga. Devuelve el mensaje de
   * error listo para mostrar o `null` si salió bien.
   */
  async function saveCategory(
    input: { name: string; icon: string },
    categoryId?: string,
  ): Promise<string | null> {
    const session = useSessionStore()
    if (!session.activeTenantId)
      return 'No se pudo guardar la categoría. Inicia sesión de nuevo.'
    const validationError = validateCategory(input)
    if (validationError) return validationError

    const fields = { name: input.name.trim(), icon: input.icon }
    try {
      if (categoryId) await categoriesService.update(categoryId, fields)
      else await categoriesService.create(session.activeTenantId, fields)
    } catch (err) {
      // 23505 = violación de índice único: ya hay una categoría con ese nombre.
      if ((err as { code?: string }).code === '23505') {
        return 'Ya existe una categoría con ese nombre.'
      }
      return 'No se pudo guardar la categoría. Revisa tu conexión.'
    }
    await load()
    return null
  }

  /** Desactiva o reactiva una categoría; sus productos no se tocan (pasan a "Sin categoría"). */
  async function setCategoryActive(
    categoryId: string,
    isActive: boolean,
  ): Promise<string | null> {
    try {
      await categoriesService.setActive(categoryId, isActive)
    } catch {
      return `No se pudo ${isActive ? 'activar' : 'desactivar'} la categoría. Revisa tu conexión.`
    }
    const category = categories.value.find((c) => c.id === categoryId)
    if (category) category.is_active = isActive
    return null
  }

  function reset(): void {
    rows.value = []
    categories.value = []
    status.value = 'idle'
    errorMessage.value = null
  }

  return {
    rows,
    categories,
    status,
    errorMessage,
    alertRows,
    load,
    registerMovement,
    saveProduct,
    setProductActive,
    saveCategory,
    setCategoryActive,
    reset,
  }
})
