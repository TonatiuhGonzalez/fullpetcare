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
export async function listByKind(
  tenantId: string,
  kind: ServiceKind,
): Promise<Service[]> {
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
  const { data, error } = await supabase
    .from('services')
    .insert(service)
    .select()
    .single()

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
 * Activa o desactiva un servicio (el switch de CatalogPage). "Desactivar"
 * es DISTINTO de borrar (ver el comentario en la migración services.sql):
 * el servicio sigue existiendo — las citas viejas que lo usaron conservan
 * su nombre y precio vía `*_snapshot` — solo deja de ofrecerse para
 * agendar uno nuevo. Reactivarlo lo vuelve a ofrecer.
 */
export async function setActive(id: string, isActive: boolean): Promise<void> {
  const { error } = await supabase
    .from('services')
    .update({ is_active: isActive })
    .eq('id', id)

  if (error) throw error
}

/**
 * Elimina un servicio con borrado SUAVE (`deleted_at`): deja de verse en el
 * catálogo, pero la fila sigue existiendo para que las citas y ventas que lo
 * usaron conserven su historial (CLAUDE.md §8.5). `listByKind` ya filtra
 * `deleted_at is null`, por eso desaparece de la pantalla.
 */
export async function remove(id: string): Promise<void> {
  const { error } = await supabase
    .from('services')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)

  if (error) throw error
}

/**
 * Busca un servicio ELIMINADO del mismo negocio y tipo con ese nombre, sin
 * importar mayúsculas ni espacios en los extremos. Sirve para avisar que "ya
 * existía" al dar de alta uno igual. Devuelve el más reciente, o null.
 */
export async function findDeletedByName(
  tenantId: string,
  kind: ServiceKind,
  name: string,
): Promise<Service | null> {
  // `ilike` sin comodines = comparación sin distinguir mayúsculas; hay que
  // escapar % _ \ porque en ilike sí son comodines.
  const pattern = name.trim().replace(/[\\%_]/g, (c) => `\\${c}`)
  const { data, error } = await supabase
    .from('services')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('kind', kind)
    .not('deleted_at', 'is', null)
    .ilike('name', pattern)
    .order('deleted_at', { ascending: false })
    .limit(1)

  if (error) throw error
  return data?.[0] ?? null
}

/**
 * Reactiva un servicio eliminado (mismo id, así el historial sigue ligado) con
 * los datos capturados ahora: vuelve a verse y a estar activo.
 */
export async function restore(id: string, changes: ServiceUpdate): Promise<Service> {
  const { data, error } = await supabase
    .from('services')
    .update({ ...changes, deleted_at: null, is_active: true })
    .eq('id', id)
    .select()
    .single()

  if (error) throw error
  return data
}
