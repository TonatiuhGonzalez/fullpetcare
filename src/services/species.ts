// Acceso a datos del catálogo de grupos y especies (fase 27, PLAN.md D30 punto 1). Las
// razas viven en `breeds.ts`. Único archivo que habla con Supabase para esto (§4).
import { supabase } from './supabase'
import type { Database } from '@/types/database'

export type SpeciesGroup = Database['public']['Tables']['species_groups']['Row']
export type Species = Database['public']['Tables']['species']['Row']
type PetSpecies = Database['public']['Enums']['pet_species']

export interface SpeciesInput {
  name: string
  group_id: string
  has_breeds: boolean
  legacy_kind?: PetSpecies
}

/** Grupos visibles del negocio, en el orden en que se muestran. */
export async function listGroups(tenantId: string): Promise<SpeciesGroup[]> {
  const { data, error } = await supabase
    .from('species_groups')
    .select('*')
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .order('sort_order')
    .order('name')

  if (error) throw error
  return data ?? []
}

/** Especies visibles del negocio (de todos los grupos), por nombre. */
export async function list(tenantId: string): Promise<Species[]> {
  const { data, error } = await supabase
    .from('species')
    .select('*')
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .order('name')

  if (error) throw error
  return data ?? []
}

/** Da de alta una especie. Solo dueño y veterinario (la política RLS lo exige). */
export async function create(tenantId: string, input: SpeciesInput): Promise<Species> {
  const { data, error } = await supabase
    .from('species')
    .insert({ ...input, tenant_id: tenantId, name: input.name.trim() })
    .select()
    .single()

  if (error) throw error
  return data
}

/** Cambia nombre, grupo o si lleva razas. `legacy_kind` no se cambia desde la pantalla. */
export async function update(id: string, input: SpeciesInput): Promise<Species> {
  const { data, error } = await supabase
    .from('species')
    .update({ ...input, name: input.name.trim() })
    .eq('id', id)
    .select()
    .single()

  if (error) throw error
  return data
}

/**
 * Oculta una especie (borrado suave): deja de ofrecerse, pero las mascotas que ya la
 * tienen conservan su especie y su raza.
 */
export async function hide(id: string): Promise<void> {
  const { error } = await supabase
    .from('species')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)

  if (error) throw error
}

/** Da de alta un grupo (al final de la lista). Solo dueño y veterinario. */
export async function createGroup(
  tenantId: string,
  name: string,
  sortOrder: number,
): Promise<SpeciesGroup> {
  const { data, error } = await supabase
    .from('species_groups')
    .insert({ tenant_id: tenantId, name: name.trim(), sort_order: sortOrder })
    .select()
    .single()

  if (error) throw error
  return data
}

export async function updateGroup(id: string, name: string): Promise<SpeciesGroup> {
  const { data, error } = await supabase
    .from('species_groups')
    .update({ name: name.trim() })
    .eq('id', id)
    .select()
    .single()

  if (error) throw error
  return data
}

/** Oculta un grupo (borrado suave). La pantalla no deja ocultar uno que aún tiene especies. */
export async function hideGroup(id: string): Promise<void> {
  const { error } = await supabase
    .from('species_groups')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)

  if (error) throw error
}
