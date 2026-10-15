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

/**
 * Productos cuyo nombre o código CONTIENE el texto, sin importar acentos ni mayúsculas
 * (C1.20). La comparación la hace la base (`search_products`), igual que en Clientes; la
 * ñ no se confunde con la n. No filtra `is_active`: ocultar los inactivos lo decide cada
 * pantalla. Texto vacío devuelve todo el catálogo.
 */
export async function search(tenantId: string, term: string): Promise<Product[]> {
  const { data, error } = await supabase.rpc('search_products', {
    p_tenant_id: tenantId,
    p_term: term,
  })

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

export interface ProductPresentationInput {
  unitsPerPackage: number
  packageName: string | null
  unitName: string | null
  /** Precio de la unidad suelta en centavos; nulo = se calcula del precio del envase. */
  unitPriceCents: number | null
  unitSatCode: string | null
}

/**
 * Cambia la presentación fraccionada de un producto (fase 29C). La RPC reescala la existencia
 * ya contada (movimiento de ajuste por sucursal) y lo rechaza, con su mensaje, si no da
 * unidades enteras. Los tipos generados marcan los argumentos opcionales como no nulos: de
 * ahí los `as string`.
 */
export async function setPresentation(
  productId: string,
  input: ProductPresentationInput,
): Promise<Product> {
  const { data, error } = await supabase.rpc('set_product_presentation', {
    p_product_id: productId,
    p_units_per_package: input.unitsPerPackage,
    p_package_name: input.packageName as string,
    p_unit_name: input.unitName as string,
    p_unit_price_cents: input.unitPriceCents as number,
    p_unit_sat_code: input.unitSatCode as string,
  })

  if (error) throw error
  return data as Product
}
