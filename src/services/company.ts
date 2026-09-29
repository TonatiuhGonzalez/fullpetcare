// Datos de la empresa (el tenant) para la vista de configuración (tarea #1959).
// Por ahora solo lectura: la pantalla los muestra, no los edita.
import { supabase } from './supabase'
import type { Database } from '@/types/database'

export type Company = Pick<
  Database['public']['Tables']['tenants']['Row'],
  | 'id'
  | 'name'
  | 'legal_name'
  | 'rfc'
  | 'tax_regime_code'
  | 'postal_code'
  | 'default_cfdi_use'
  | 'timezone'
>

/** La empresa con `tenantId`. RLS solo deja leer los negocios donde la persona es miembro. */
export async function getById(tenantId: string): Promise<Company | null> {
  const { data, error } = await supabase
    .from('tenants')
    .select('id, name, legal_name, rfc, tax_regime_code, postal_code, default_cfdi_use, timezone')
    .eq('id', tenantId)
    .maybeSingle()

  if (error) throw error
  return data
}
