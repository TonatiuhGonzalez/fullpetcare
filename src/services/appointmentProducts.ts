// Acceso a datos de los productos y medicamentos usados en una consulta
// (tabla `appointment_products`). Único archivo que habla con Supabase para esto
// (CLAUDE.md §4).
//
// Las líneas NO se escriben con insert/update: se registran y se quitan con las
// RPC add_appointment_product / remove_appointment_product, que mueven la
// existencia en la misma transacción (migración appointment_products.sql).
import { supabase } from './supabase'
import type { Database } from '@/types/database'

export type AppointmentProduct =
  Database['public']['Tables']['appointment_products']['Row']

/** Un producto que se puede registrar hoy en una sucursal (activo y con existencia). */
export interface AvailableProduct {
  id: string
  name: string
  stock: number
}

/** Insumos registrados en una cita, en el orden en que se anotaron. */
export async function listByAppointment(
  tenantId: string,
  appointmentId: string,
): Promise<AppointmentProduct[]> {
  const { data, error } = await supabase
    .from('appointment_products')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('appointment_id', appointmentId)
    .is('deleted_at', null)
    .order('created_at')

  if (error) throw error
  return data ?? []
}

/**
 * Productos que se pueden usar en una sucursal: activos y con existencia. Con
 * existencia 0 no se ofrecen (decisión #2 de la fase); la base lo vuelve a
 * validar al registrar.
 */
export async function listAvailable(
  tenantId: string,
  branchId: string,
): Promise<AvailableProduct[]> {
  const [productsResult, stockResult] = await Promise.all([
    supabase
      .from('products')
      .select('id, name')
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .is('deleted_at', null)
      .order('name'),
    supabase
      .from('product_stock')
      .select('product_id, stock')
      .eq('tenant_id', tenantId)
      .eq('branch_id', branchId),
  ])

  if (productsResult.error) throw productsResult.error
  if (stockResult.error) throw stockResult.error

  const stockByProduct = new Map(
    (stockResult.data ?? []).map((r) => [r.product_id, r.stock]),
  )
  return (productsResult.data ?? [])
    .map((p) => ({ id: p.id, name: p.name, stock: stockByProduct.get(p.id) ?? 0 }))
    .filter((p) => p.stock > 0)
}

export interface AddAppointmentProductArgs {
  appointmentId: string
  productId: string
  quantity: number
  /** true: se cobra al cliente; false: uso interno (guantes, gasas). */
  isBillable: boolean
}

/** Registra un insumo y baja la existencia. Devuelve el id de la línea. */
export async function add(args: AddAppointmentProductArgs): Promise<string> {
  const { data, error } = await supabase.rpc('add_appointment_product', {
    p_appointment_id: args.appointmentId,
    p_product_id: args.productId,
    p_quantity: args.quantity,
    p_is_billable: args.isBillable,
  })

  if (error) throw error
  return data
}

/** Quita una línea y devuelve la existencia que había sacado. */
export async function remove(lineId: string): Promise<void> {
  const { error } = await supabase.rpc('remove_appointment_product', {
    p_line_id: lineId,
  })

  if (error) throw error
}

/**
 * Mensaje en español para un error de las RPC de insumos. Las RPC rechazan los
 * casos de negocio con un texto propio; se reconocen aquí para no mostrar un
 * genérico "revisa tu conexión" que sería falso (CLAUDE.md §5.4).
 */
export function errorMessage(err: unknown): string {
  const message =
    typeof err === 'object' && err !== null && 'message' in err
      ? String((err as { message: unknown }).message)
      : ''

  if (/no tiene existencia|no hay existencia suficiente/i.test(message)) {
    return 'No hay existencia suficiente de ese producto.'
  }
  if (/ya fue cobrada/i.test(message))
    return 'La cita ya fue cobrada: no se pueden cambiar sus productos.'
  if (/vacuna ya registrada/i.test(message))
    return 'Esta pieza corresponde a una vacuna ya registrada.'
  if (/permiso/i.test(message))
    return 'No tienes permiso para registrar productos usados.'
  if (/no existe o no está disponible/i.test(message))
    return 'Ese producto ya no está disponible.'
  return 'No se pudo completar la acción. Revisa tu conexión.'
}
