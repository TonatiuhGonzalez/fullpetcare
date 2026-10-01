// Tests de useInventoryStore. Los services se reemplazan por versiones falsas
// (mismo patrón que session.spec.ts): aquí se prueba la lógica del store, no
// que Supabase responda; eso lo cubren los tests de supabase/tests/.
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useInventoryStore } from './inventory'
import { useSessionStore } from './session'

// useSessionStore importa estos services, y todos terminan en
// services/supabase.ts, que lanza error si no hay VITE_SUPABASE_URL. En tu Mac
// existe .env.local y pasa; en el CI no, y el archivo entero fallaba al
// importar. Se mockean igual que en session.spec.ts para no tocar Supabase.
vi.mock('@/services/auth', () => ({
  signIn: vi.fn(),
  signOut: vi.fn(),
  getCurrentUser: vi.fn(),
  onSessionLost: vi.fn(),
}))
vi.mock('@/services/profiles', () => ({ getProfile: vi.fn() }))
vi.mock('@/services/memberships', () => ({ listMyMemberships: vi.fn() }))
vi.mock('@/services/tenantAccess', () => ({
  listMyTenantNotices: vi.fn(),
  cancelMyTenant: vi.fn(),
}))
vi.mock('@/services/permissions', () => ({ listForTenant: vi.fn() }))
vi.mock('@/services/platform', () => ({ isPlatformAdmin: vi.fn() }))
vi.mock('@/services/products', () => ({ list: vi.fn() }))
vi.mock('@/services/inventory', () => ({ listStock: vi.fn(), registerMovement: vi.fn() }))

import * as inventoryService from '@/services/inventory'
import * as productsService from '@/services/products'
import type { Product } from '@/services/products'

function product(id: string, over: Partial<Product> = {}): Product {
  return { id, name: id, min_stock: 3, is_active: true, ...over } as Product
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  const session = useSessionStore()
  session.activeTenantId = 'tenant-a'
  session.activeBranchId = 'branch-1'
  // @ts-expect-error -- solo hace falta el id del usuario para estos tests.
  session.user = { id: 'user-1' }
})

describe('load', () => {
  it('combina catálogo y existencias y marca el estado de cada producto', async () => {
    // Si el estado se calculara mal, "Sin inventario" o "Stock bajo" no
    // aparecerían y el mostrador vendería lo que no hay.
    vi.mocked(productsService.list).mockResolvedValue([
      product('ok'),
      product('bajo'),
      product('cero'),
    ])
    vi.mocked(inventoryService.listStock).mockResolvedValue([
      { tenant_id: 'tenant-a', branch_id: 'branch-1', product_id: 'ok', stock: 10 },
      { tenant_id: 'tenant-a', branch_id: 'branch-1', product_id: 'bajo', stock: 3 },
      { tenant_id: 'tenant-a', branch_id: 'branch-1', product_id: 'cero', stock: 0 },
    ])
    const store = useInventoryStore()

    await store.load()

    expect(store.rows.map((r) => [r.product.id, r.stock, r.status])).toEqual([
      ['ok', 10, 'ok'],
      ['bajo', 3, 'low'],
      ['cero', 0, 'out'],
    ])
    expect(store.alertRows.map((r) => r.product.id)).toEqual(['bajo', 'cero'])
  })

  it('un producto sin fila en la vista cuenta como existencia 0, no undefined', async () => {
    // Evita el "NaN" en pantalla si la vista aún no devolvió ese producto.
    vi.mocked(productsService.list).mockResolvedValue([product('nuevo')])
    vi.mocked(inventoryService.listStock).mockResolvedValue([])
    const store = useInventoryStore()

    await store.load()

    expect(store.rows[0]).toMatchObject({ stock: 0, status: 'out' })
  })

  it('los productos inactivos no generan alerta', async () => {
    // Un producto desactivado sin existencia no debe llenar el aviso de
    // "stock bajo": ya no se vende.
    vi.mocked(productsService.list).mockResolvedValue([product('viejo', { is_active: false })])
    vi.mocked(inventoryService.listStock).mockResolvedValue([])
    const store = useInventoryStore()

    await store.load()

    expect(store.alertRows).toEqual([])
  })

  it('si falla la consulta deja un mensaje en español y estado de error', async () => {
    // La UI muestra el mensaje tal cual; no debe filtrarse un error técnico.
    vi.mocked(productsService.list).mockRejectedValue(new Error('PGRST116'))
    vi.mocked(inventoryService.listStock).mockResolvedValue([])
    const store = useInventoryStore()

    await store.load()

    expect(store.status).toBe('error')
    expect(store.errorMessage).toBe('No se pudo cargar el inventario. Revisa tu conexión.')
  })
})

describe('registerMovement', () => {
  async function loaded(stock: number) {
    vi.mocked(productsService.list).mockResolvedValue([product('p1')])
    vi.mocked(inventoryService.listStock).mockResolvedValue([
      { tenant_id: 'tenant-a', branch_id: 'branch-1', product_id: 'p1', stock },
    ])
    const store = useInventoryStore()
    await store.load()
    vi.mocked(inventoryService.listStock).mockClear()
    return store
  }

  it('una merma mayor a la existencia se rechaza sin llamar a la base', async () => {
    // Ahorra un viaje y da el mensaje claro; la base igual lo rechazaría.
    const store = await loaded(2)

    const error = await store.registerMovement({
      productId: 'p1',
      type: 'loss',
      quantity: 5,
      reason: 'Caducado',
    })

    expect(error).toBe('No hay existencia suficiente: hay 2.')
    expect(inventoryService.registerMovement).not.toHaveBeenCalled()
  })

  it('un ajuste sin motivo se rechaza', async () => {
    // El motivo es obligatorio para poder explicar el cambio después.
    const store = await loaded(2)

    const error = await store.registerMovement({ productId: 'p1', type: 'adjustment', quantity: 1 })

    expect(error).toBe('Escribe el motivo.')
    expect(inventoryService.registerMovement).not.toHaveBeenCalled()
  })

  it('una compra válida se registra con el negocio, sucursal y usuario activos y recarga', async () => {
    // Si usara otra sucursal o usuario, el movimiento quedaría en el lugar
    // equivocado o a nombre de otra persona (la base lo rechazaría).
    const store = await loaded(2)

    const error = await store.registerMovement({ productId: 'p1', type: 'purchase', quantity: 4 })

    expect(error).toBeNull()
    expect(inventoryService.registerMovement).toHaveBeenCalledWith({
      productId: 'p1',
      type: 'purchase',
      quantity: 4,
      tenantId: 'tenant-a',
      branchId: 'branch-1',
      userId: 'user-1',
    })
    expect(inventoryService.listStock).toHaveBeenCalledTimes(1) // recargó
  })

  it('si la base rechaza el movimiento devuelve un mensaje en español', async () => {
    // Por ejemplo, otra persona vendió la última pieza justo antes.
    const store = await loaded(2)
    vi.mocked(inventoryService.registerMovement).mockRejectedValue(new Error('check_violation'))

    const error = await store.registerMovement({ productId: 'p1', type: 'purchase', quantity: 1 })

    expect(error).toBe('No se pudo registrar el movimiento. Revisa tu conexión.')
  })
})
