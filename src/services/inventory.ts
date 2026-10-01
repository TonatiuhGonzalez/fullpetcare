// Acceso a datos de existencias: bitácora `stock_movements` y la vista
// `product_stock` (migración stock_movements.sql). Único archivo que habla con
// Supabase para esto (CLAUDE.md §4).
//
// La existencia NO se escribe nunca: se registra un movimiento y la vista
// recalcula. Por eso aquí no hay update ni delete de movimientos (la base
// tampoco los permite): corregir un error es registrar otro movimiento.
import { supabase } from './supabase'
import { signedQuantity, type ManualMovementType } from '@/lib/inventory'
import type { Database } from '@/types/database'

export type StockMovement = Database['public']['Tables']['stock_movements']['Row']
export type StockMovementType = Database['public']['Enums']['stock_movement_type']
export type ProductStock = Database['public']['Views']['product_stock']['Row']

export interface NewMovement {
  tenantId: string
  branchId: string
  productId: string
  /** Quien lo registra. La política exige que sea el usuario autenticado. */
  userId: string
  type: ManualMovementType
  /** Entero mayor a 0; el signo lo decide el tipo (y `direction` en los ajustes). */
  quantity: number
  direction?: 'in' | 'out'
  /** Obligatorio en ajustes y mermas. */
  reason?: string
}

/** Existencia actual de cada producto en una sucursal (0 si no tiene movimientos). */
export async function listStock(tenantId: string, branchId: string): Promise<ProductStock[]> {
  const { data, error } = await supabase
    .from('product_stock')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('branch_id', branchId)

  if (error) throw error
  return data ?? []
}

/** Historial de un producto en una sucursal, del más reciente al más antiguo. */
export async function listMovements(
  tenantId: string,
  branchId: string,
  productId: string,
): Promise<StockMovement[]> {
  const { data, error } = await supabase
    .from('stock_movements')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('branch_id', branchId)
    .eq('product_id', productId)
    .order('created_at', { ascending: false })

  if (error) throw error
  return data ?? []
}

/**
 * Registra una compra, un ajuste o una merma. Calcula el signo aquí para que
 * quien llama capture siempre una cantidad positiva. Si no alcanza la
 * existencia, la base rechaza el movimiento (check_violation) y esto lanza.
 */
export async function registerMovement(movement: NewMovement): Promise<StockMovement> {
  const { data, error } = await supabase
    .from('stock_movements')
    .insert({
      tenant_id: movement.tenantId,
      branch_id: movement.branchId,
      product_id: movement.productId,
      created_by: movement.userId,
      movement_type: movement.type,
      quantity: signedQuantity(movement.type, movement.quantity, movement.direction),
      reason: movement.reason?.trim() || null,
    })
    .select()
    .single()

  if (error) throw error
  return data
}
