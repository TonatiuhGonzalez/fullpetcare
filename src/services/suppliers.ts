// Acceso a datos del catálogo de proveedores y de su vínculo con los productos (fase 29B,
// PLAN.md D30). Único archivo que habla con Supabase para esto (CLAUDE.md §4).
import { supabase } from './supabase'
import type { Database } from '@/types/database'

export type Supplier = Database['public']['Tables']['suppliers']['Row']
export type SupplierType = Database['public']['Enums']['supplier_type']
export type ProductSupplierLink = Pick<
  Database['public']['Tables']['product_suppliers']['Row'],
  'product_id' | 'supplier_id'
>

export interface SupplierInput {
  name: string
  supplier_type: SupplierType
  contact_name: string | null
  phone: string | null
  email: string | null
  notes: string | null
}

/**
 * Proveedores del negocio, activos e inactivos (la pantalla necesita ver los inactivos
 * para reactivarlos), por nombre. El filtro de borrado suave va aquí y no en la política
 * (trampa de CLAUDE.md §7.2).
 */
export async function list(tenantId: string): Promise<Supplier[]> {
  const { data, error } = await supabase
    .from('suppliers')
    .select('*')
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .order('name')

  if (error) throw error
  return data ?? []
}

export async function create(tenantId: string, input: SupplierInput): Promise<Supplier> {
  const { data, error } = await supabase
    .from('suppliers')
    .insert({ ...input, tenant_id: tenantId, name: input.name.trim() })
    .select()
    .single()

  if (error) throw error
  return data
}

export async function update(id: string, input: SupplierInput): Promise<Supplier> {
  const { data, error } = await supabase
    .from('suppliers')
    .update({ ...input, name: input.name.trim() })
    .eq('id', id)
    .select()
    .single()

  if (error) throw error
  return data
}

/** Desactivar no borra: el proveedor deja de ofrecerse pero conserva sus productos. */
export async function setActive(id: string, isActive: boolean): Promise<void> {
  const { error } = await supabase
    .from('suppliers')
    .update({ is_active: isActive })
    .eq('id', id)

  if (error) throw error
}

/** Todos los vínculos producto-proveedor vigentes del negocio. */
export async function listLinks(tenantId: string): Promise<ProductSupplierLink[]> {
  const { data, error } = await supabase
    .from('product_suppliers')
    .select('product_id, supplier_id')
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)

  if (error) throw error
  return data ?? []
}

/**
 * Deja a un producto con EXACTAMENTE estos proveedores. Calcula la diferencia: quita
 * (borrado suave) los que ya no están y agrega los nuevos; los que siguen no se tocan.
 * Se puede volver a agregar uno que se había quitado (el índice único ignora los ocultos).
 */
export async function setProductSuppliers(
  tenantId: string,
  productId: string,
  supplierIds: string[],
): Promise<void> {
  const { data: current, error: fetchError } = await supabase
    .from('product_suppliers')
    .select('id, supplier_id')
    .eq('tenant_id', tenantId)
    .eq('product_id', productId)
    .is('deleted_at', null)
  if (fetchError) throw fetchError

  const rows = current ?? []
  const desired = new Set(supplierIds)
  const existing = new Set(rows.map((r) => r.supplier_id))

  const toRemove = rows.filter((r) => !desired.has(r.supplier_id)).map((r) => r.id)
  const toAdd = [...desired].filter((id) => !existing.has(id))

  if (toRemove.length > 0) {
    const { error } = await supabase
      .from('product_suppliers')
      .update({ deleted_at: new Date().toISOString() })
      .in('id', toRemove)
    if (error) throw error
  }

  if (toAdd.length > 0) {
    const { error } = await supabase.from('product_suppliers').insert(
      toAdd.map((supplierId) => ({
        tenant_id: tenantId,
        product_id: productId,
        supplier_id: supplierId,
      })),
    )
    if (error) throw error
  }
}
