// Acceso a datos del catálogo de razas (fase 27, PLAN.md D30 punto 1). Cada raza cuelga de
// una especie; `search_aliases` son las otras formas de escribirla ("xolo", "teckel").
import { supabase } from './supabase'
import type { Database } from '@/types/database'

export type Breed = Database['public']['Tables']['breeds']['Row']

export interface BreedInput {
  name: string
  species_id: string
  search_aliases: string[]
}

/** Razas visibles del negocio (de todas las especies), por nombre. */
export async function list(tenantId: string): Promise<Breed[]> {
  const { data, error } = await supabase
    .from('breeds')
    .select('*')
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .order('name')

  if (error) throw error
  return data ?? []
}

export async function create(tenantId: string, input: BreedInput): Promise<Breed> {
  const { data, error } = await supabase
    .from('breeds')
    .insert({ ...input, tenant_id: tenantId, name: input.name.trim() })
    .select()
    .single()

  if (error) throw error
  return data
}

export async function update(id: string, input: BreedInput): Promise<Breed> {
  const { data, error } = await supabase
    .from('breeds')
    .update({ ...input, name: input.name.trim() })
    .eq('id', id)
    .select()
    .single()

  if (error) throw error
  return data
}

/** Oculta una raza (borrado suave): las mascotas que ya la tienen la conservan. */
export async function hide(id: string): Promise<void> {
  const { error } = await supabase
    .from('breeds')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)

  if (error) throw error
}
