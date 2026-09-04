// Acceso a datos de customers. Única capa que habla con Supabase para
// esto (CLAUDE.md §4) — pages/stores nunca importan supabase.ts directo.
import { supabase } from './supabase'
import type { Database } from '@/types/database'

export type Customer = Database['public']['Tables']['customers']['Row']
export type NewCustomer = Database['public']['Tables']['customers']['Insert']
export type CustomerUpdate = Database['public']['Tables']['customers']['Update']

/**
 * Todos los clientes activos (sin borrado suave) de un tenant, por
 * apellido y luego nombre.
 */
export async function list(tenantId: string): Promise<Customer[]> {
  const { data, error } = await supabase
    .from('customers')
    .select('*')
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .order('last_name')
    .order('first_name')

  if (error) throw error
  return data ?? []
}

/**
 * Busca clientes cuyo nombre O apellido EMPIEZA con `term` (no
 * "contiene en cualquier parte" — ver el comentario del índice en la
 * migración `customers.sql` para el porqué). Cadena vacía o solo
 * espacios devuelve la lista completa, igual que `list()` — así el
 * cuadro de búsqueda de la UI (tarea 2.16) puede llamar siempre a
 * `search()` sin tener que decidir cuándo usar `list()` en su lugar.
 */
export async function search(tenantId: string, term: string): Promise<Customer[]> {
  const trimmed = term.trim()
  if (trimmed === '') return list(tenantId)

  // .or() arma un WHERE con OR entre las dos condiciones — "empieza con
  // el término, ya sea en el nombre o en el apellido". El "%" al final
  // es el comodín de SQL para "lo que sea después".
  const { data, error } = await supabase
    .from('customers')
    .select('*')
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .or(`first_name.ilike.${trimmed}%,last_name.ilike.${trimmed}%`)
    .order('last_name')
    .order('first_name')

  if (error) throw error
  return data ?? []
}

/**
 * Un cliente por id, o `null` si no existe o no es de este tenant (RLS
 * lo hace invisible, no lanza error — ver CLAUDE.md §7.1).
 */
export async function getById(tenantId: string, id: string): Promise<Customer | null> {
  const { data, error } = await supabase
    .from('customers')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle()

  if (error) throw error
  return data
}

export async function create(customer: NewCustomer): Promise<Customer> {
  const { data, error } = await supabase
    .from('customers')
    .insert(customer)
    .select()
    .single()

  if (error) throw error
  return data
}

export async function update(id: string, changes: CustomerUpdate): Promise<Customer> {
  const { data, error } = await supabase
    .from('customers')
    .update(changes)
    .eq('id', id)
    .select()
    .single()

  if (error) throw error
  return data
}

/**
 * Borrado suave (CLAUDE.md §8.5): un UPDATE de `deleted_at`, nunca un
 * DELETE — la tabla no tiene política de DELETE, Postgres lo rechazaría.
 */
export async function softDelete(id: string): Promise<void> {
  const { error } = await supabase
    .from('customers')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)

  if (error) throw error
}
