// Acceso a datos de pets y pet_weights. Único archivo que habla con
// Supabase para esto (CLAUDE.md §4).
import { supabase } from './supabase'
import type { Database } from '@/types/database'

export type Pet = Database['public']['Tables']['pets']['Row']
export type NewPet = Database['public']['Tables']['pets']['Insert']
export type PetUpdate = Database['public']['Tables']['pets']['Update']
export type PetWeight = Database['public']['Tables']['pet_weights']['Row']

/** Todas las mascotas activas de un tenant, por nombre. */
export async function list(tenantId: string): Promise<Pet[]> {
  const { data, error } = await supabase
    .from('pets')
    .select('*')
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .order('name')

  if (error) throw error
  return data ?? []
}

/**
 * Las mascotas de un cliente en particular — lo que necesita la ficha
 * del cliente (tarea 2.18).
 */
export async function listByCustomer(tenantId: string, customerId: string): Promise<Pet[]> {
  const { data, error } = await supabase
    .from('pets')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('customer_id', customerId)
    .is('deleted_at', null)
    .order('name')

  if (error) throw error
  return data ?? []
}

export async function getById(tenantId: string, id: string): Promise<Pet | null> {
  const { data, error } = await supabase
    .from('pets')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle()

  if (error) throw error
  return data
}

export async function create(pet: NewPet): Promise<Pet> {
  const { data, error } = await supabase.from('pets').insert(pet).select().single()

  if (error) throw error
  return data
}

export async function update(id: string, changes: PetUpdate): Promise<Pet> {
  const { data, error } = await supabase
    .from('pets')
    .update(changes)
    .eq('id', id)
    .select()
    .single()

  if (error) throw error
  return data
}

/** Borrado suave (CLAUDE.md §8.5): un UPDATE de deleted_at, nunca un DELETE. */
export async function softDelete(id: string): Promise<void> {
  const { error } = await supabase.from('pets').update({ deleted_at: new Date().toISOString() }).eq('id', id)

  if (error) throw error
}

/**
 * Registra un peso nuevo. No hay `updateWeight`: un peso mal capturado
 * se corrige agregando una medición nueva, no editando el historial —
 * `pet_weights` es un registro de hechos que ya pasaron (igual que
 * `audit_log`), no un valor que se sobrescribe.
 */
export async function addWeight(
  tenantId: string,
  petId: string,
  weightGrams: number,
): Promise<PetWeight> {
  const { data, error } = await supabase
    .from('pet_weights')
    .insert({ tenant_id: tenantId, pet_id: petId, weight_grams: weightGrams })
    .select()
    .single()

  if (error) throw error
  return data
}

/** Historial de peso de una mascota, del más reciente al más viejo. */
export async function listWeights(tenantId: string, petId: string): Promise<PetWeight[]> {
  const { data, error } = await supabase
    .from('pet_weights')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('pet_id', petId)
    .is('deleted_at', null)
    .order('measured_at', { ascending: false })

  if (error) throw error
  return data ?? []
}
