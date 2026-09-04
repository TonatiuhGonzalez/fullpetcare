// Acceso a datos del catálogo `vaccines` (tarea 4.15: VaccinationDialog
// necesita ofrecer una lista). Único archivo que habla con Supabase para
// esto (CLAUDE.md §4).
import { supabase } from './supabase'
import type { Database } from '@/types/database'

export type Vaccine = Database['public']['Tables']['vaccines']['Row']
type PetSpecies = Database['public']['Enums']['pet_species']

/**
 * Las vacunas que tiene sentido ofrecer para una mascota: las de su
 * especie más las que aplican a cualquiera (`species` nulo — rabia y
 * bordetella, por ejemplo, se dan igual a perros y gatos).
 */
export async function listForSpecies(tenantId: string, species: PetSpecies): Promise<Vaccine[]> {
  const { data, error } = await supabase
    .from('vaccines')
    .select('*')
    .eq('tenant_id', tenantId)
    .or(`species.is.null,species.eq.${species}`)
    .is('deleted_at', null)
    .order('name')

  if (error) throw error
  return data ?? []
}
