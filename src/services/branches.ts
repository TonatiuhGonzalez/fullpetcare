// Acceso a datos de branches. Por ahora solo lo que necesita agendar una
// cita (tarea 3.18): el horario de apertura, para calcular huecos
// disponibles con lib/availability.ts.
import { supabase } from './supabase'
import type { Database } from '@/types/database'

export type Branch = Database['public']['Tables']['branches']['Row']

export async function getById(id: string): Promise<Branch | null> {
  const { data, error } = await supabase
    .from('branches')
    .select('*')
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle()

  if (error) throw error
  return data
}

/** Todas las sucursales activas de un tenant, por nombre — usado por la pantalla de empleados (fase 9) para armar el selector de sucursales. */
export async function listByTenant(tenantId: string): Promise<Branch[]> {
  const { data, error } = await supabase
    .from('branches')
    .select('*')
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .order('name')

  if (error) throw error
  return data ?? []
}
