// Acceso a datos del catálogo (tabla `services`). Único archivo que
// habla con Supabase para esto (CLAUDE.md §4).
import { supabase } from './supabase'
import type { Database } from '@/types/database'

export type Service = Database['public']['Tables']['services']['Row']
export type ServiceKind = Database['public']['Enums']['service_kind']
export type NewService = Database['public']['Tables']['services']['Insert']
export type ServiceUpdate = Database['public']['Tables']['services']['Update']

/**
 * Catálogo de un tipo (estética o veterinaria), activo e inactivo por
 * igual — CatalogPage (tarea 3.16) necesita ver los servicios
 * desactivados para poder reactivarlos; es el paso de "agendar"
 * (tarea 3.18) el que filtra por `is_active` al armar sus opciones, no
 * este método.
 */
export async function listByKind(tenantId: string, kind: ServiceKind): Promise<Service[]> {
  const { data, error } = await supabase
    .from('services')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('kind', kind)
    .is('deleted_at', null)
    .order('name')

  if (error) throw error
  return data ?? []
}

export async function create(service: NewService): Promise<Service> {
  const { data, error } = await supabase.from('services').insert(service).select().single()

  if (error) throw error
  return data
}

export async function update(id: string, changes: ServiceUpdate): Promise<Service> {
  const { data, error } = await supabase
    .from('services')
    .update(changes)
    .eq('id', id)
    .select()
    .single()

  if (error) throw error
  return data
}

/**
 * "Desactivar" es DISTINTO de borrar (ver el comentario en la migración
 * services.sql): el servicio sigue existiendo — las citas viejas que lo
 * usaron conservan su nombre y precio vía `*_snapshot` — solo deja de
 * ofrecerse para agendar uno nuevo.
 */
export async function deactivate(id: string): Promise<void> {
  const { error } = await supabase.from('services').update({ is_active: false }).eq('id', id)

  if (error) throw error
}
