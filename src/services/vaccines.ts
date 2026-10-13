// Acceso a datos del catálogo `vaccines` (tarea 4.15: VaccinationDialog
// necesita ofrecer una lista). Único archivo que habla con Supabase para
// esto (CLAUDE.md §4).
import { supabase } from './supabase'
import type { Database } from '@/types/database'

export type Vaccine = Database['public']['Tables']['vaccines']['Row']
type PetSpecies = Database['public']['Enums']['pet_species']
export type VaccineInput = Pick<
  Database['public']['Tables']['vaccines']['Insert'],
  'name' | 'species' | 'default_interval_days'
>

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

/**
 * Todo el catálogo activo del negocio (cualquier especie), por nombre. Es lo que ve la
 * pantalla donde se edita; `listForSpecies` es lo que ofrece el diálogo de vacunación.
 */
export async function listAll(tenantId: string): Promise<Vaccine[]> {
  const { data, error } = await supabase
    .from('vaccines')
    .select('*')
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .order('name')

  if (error) throw error
  return data ?? []
}

/** Da de alta una vacuna. Solo dueño y veterinario (la política RLS lo exige). */
export async function create(tenantId: string, input: VaccineInput): Promise<Vaccine> {
  const { data, error } = await supabase
    .from('vaccines')
    .insert({ ...input, tenant_id: tenantId, name: input.name.trim() })
    .select()
    .single()

  if (error) throw error
  return data
}

export async function update(id: string, input: VaccineInput): Promise<Vaccine> {
  const { data, error } = await supabase
    .from('vaccines')
    .update({ ...input, name: input.name.trim() })
    .eq('id', id)
    .select()
    .single()

  if (error) throw error
  return data
}

/**
 * Oculta una vacuna (borrado suave): deja de ofrecerse al registrar dosis nuevas, pero las
 * que ya se aplicaron conservan su nombre en la cartilla y en el historial.
 */
export async function hide(id: string): Promise<void> {
  const { error } = await supabase
    .from('vaccines')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)

  if (error) throw error
}
