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
