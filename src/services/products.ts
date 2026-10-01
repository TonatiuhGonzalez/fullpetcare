// Acceso a datos del catálogo de productos (tabla `products`). Único archivo que
// habla con Supabase para esto (CLAUDE.md §4). Las existencias viven en
// services/inventory.ts.
import { supabase } from './supabase'
import type { Database } from '@/types/database'

export type Product = Database['public']['Tables']['products']['Row']
export type NewProduct = Database['public']['Tables']['products']['Insert']
export type ProductUpdate = Database['public']['Tables']['products']['Update']

/**
 * Catálogo del negocio, activo e inactivo por igual: la pantalla de Inventario
 * necesita ver los desactivados para poder reactivarlos. El filtro de borrado
 * suave va aquí y no en la política (trampa de CLAUDE.md §7.2).
 */
export async function list(tenantId: string): Promise<Product[]> {
  const { data, error } = await supabase
    .from('products')
    .select('*')
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .order('name')

  if (error) throw error
  return data ?? []
}

export async function create(product: NewProduct): Promise<Product> {
  const { data, error } = await supabase.from('products').insert(product).select().single()

  if (error) throw error
  return data
}

export async function update(id: string, changes: ProductUpdate): Promise<Product> {
  const { data, error } = await supabase
    .from('products')
    .update(changes)
    .eq('id', id)
    .select()
    .single()

  if (error) throw error
  return data
}

/** Desactivar no borra: el producto conserva su historial pero deja de ofrecerse. */
export async function setActive(id: string, isActive: boolean): Promise<void> {
  const { error } = await supabase.from('products').update({ is_active: isActive }).eq('id', id)

  if (error) throw error
}
