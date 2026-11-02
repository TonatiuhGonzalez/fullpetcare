// Proveedores del negocio activo y qué productos surte cada uno (fase 29B, PLAN.md D30).
// Lo usan la pantalla de Proveedores y el formulario de producto (selector de proveedores).
import { computed, ref } from 'vue'
import { defineStore } from 'pinia'

import * as suppliersService from '@/services/suppliers'
import type { ProductSupplierLink, Supplier } from '@/services/suppliers'
import { useSessionStore } from './session'

export const useSuppliersStore = defineStore('suppliers', () => {
  const suppliers = ref<Supplier[]>([])
  const links = ref<ProductSupplierLink[]>([])
  const status = ref<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const errorMessage = ref<string | null>(null)

  /** Proveedores que se pueden elegir al asignar a un producto (los activos). */
  const activeSuppliers = computed(() => suppliers.value.filter((s) => s.is_active))

  async function load(): Promise<void> {
    const session = useSessionStore()
    if (!session.activeTenantId) return
    status.value = 'loading'
    errorMessage.value = null
    try {
      const tenantId = session.activeTenantId
      ;[suppliers.value, links.value] = await Promise.all([
        suppliersService.list(tenantId),
        suppliersService.listLinks(tenantId),
      ])
      status.value = 'ready'
    } catch {
      status.value = 'error'
      errorMessage.value = 'No se pudieron cargar los proveedores. Revisa tu conexión.'
    }
  }

  /** Ids de los proveedores de un producto. */
  function supplierIdsOf(productId: string): string[] {
    return links.value.filter((l) => l.product_id === productId).map((l) => l.supplier_id)
  }

  /** Cuántos productos surte un proveedor. */
  function productCountOf(supplierId: string): number {
    return links.value.filter((l) => l.supplier_id === supplierId).length
  }

  /** Alta o edición; recarga y devuelve el mensaje de error (o `null` si salió bien). */
  async function save(
    input: suppliersService.SupplierInput,
    supplierId?: string,
  ): Promise<string | null> {
    const session = useSessionStore()
    if (!session.activeTenantId)
      return 'No se pudo guardar el proveedor. Inicia sesión de nuevo.'
    try {
      if (supplierId) await suppliersService.update(supplierId, input)
      else await suppliersService.create(session.activeTenantId, input)
    } catch {
      return 'No se pudo guardar el proveedor. Revisa tu conexión.'
    }
    await load()
    return null
  }

  async function setActive(
    supplierId: string,
    isActive: boolean,
  ): Promise<string | null> {
    try {
      await suppliersService.setActive(supplierId, isActive)
    } catch {
      return `No se pudo ${isActive ? 'activar' : 'desactivar'} el proveedor. Revisa tu conexión.`
    }
    const found = suppliers.value.find((s) => s.id === supplierId)
    if (found) found.is_active = isActive
    return null
  }

  return {
    suppliers,
    links,
    status,
    errorMessage,
    activeSuppliers,
    load,
    supplierIdsOf,
    productCountOf,
    save,
    setActive,
  }
})
