// Acceso a datos de las categorías de producto (tabla `product_categories`, fase 13 / 13G).
// Único archivo que habla con Supabase para esto (CLAUDE.md §4).
import { supabase } from './supabase'
import type { Database } from '@/types/database'

export type ProductCategory = Database['public']['Tables']['product_categories']['Row']

/**
 * Categorías del negocio, activas e inactivas (Inventario necesita ver las inactivas para
 * reactivarlas). El filtro de borrado suave va aquí y no en la política (trampa de §7.2).
 */
export async function list(tenantId: string): Promise<ProductCategory[]> {
  const { data, error } = await supabase
    .from('product_categories')
    .select('*')
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .order('name')

  if (error) throw error
  return data ?? []
}

/** Solo las activas: lo que ofrece el punto de venta y el selector del formulario de producto. */
export async function listActive(tenantId: string): Promise<ProductCategory[]> {
  const all = await list(tenantId)
  return all.filter((c) => c.is_active)
}

export async function create(
  tenantId: string,
  input: { name: string; icon: string },
): Promise<ProductCategory> {
  const { data, error } = await supabase
    .from('product_categories')
    .insert({ tenant_id: tenantId, name: input.name, icon: input.icon })
    .select()
    .single()

  if (error) throw error
  return data
}

export async function update(
  id: string,
  changes: { name?: string; icon?: string },
): Promise<ProductCategory> {
  const { data, error } = await supabase
    .from('product_categories')
    .update(changes)
    .eq('id', id)
    .select()
    .single()

  if (error) throw error
  return data
}

/** Desactivar no toca los productos: pasan a "Sin categoría" hasta que se reactive o se reasignen. */
export async function setActive(id: string, isActive: boolean): Promise<void> {
  const { error } = await supabase
    .from('product_categories')
    .update({ is_active: isActive })
    .eq('id', id)

  if (error) throw error
}
