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
 *
 * `appointmentId` es opcional: se manda cuando el peso se toma durante
 * una cita (tarea 4.10/4.14, ficha de veterinaria) para que quede
 * ligado a esa visita; una pesada suelta desde la ficha de la mascota
 * no tiene cita que asociar.
 */
export async function addWeight(
  tenantId: string,
  petId: string,
  weightGrams: number,
  appointmentId?: string,
): Promise<PetWeight> {
  const { data, error } = await supabase
    .from('pet_weights')
    .insert({
      tenant_id: tenantId,
      pet_id: petId,
      weight_grams: weightGrams,
      appointment_id: appointmentId ?? null,
    })
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

/**
 * Sube una foto al bucket privado `pet-photos` y devuelve la RUTA
 * (no una URL) para guardar en `pets.photo_path`. La ruta empieza con
 * `tenantId` a propósito: es lo que la política de Storage revisa para
 * decidir quién puede leerla (ver la migración `pet_photos_bucket.sql`).
 * `upsert: true` porque, si la mascota ya tenía foto, se sube al MISMO
 * nombre de archivo fijo ("foto") para no acumular archivos huérfanos
 * cada vez que alguien cambia la foto.
 */
export async function uploadPhoto(
  tenantId: string,
  petId: string,
  file: File,
): Promise<string> {
  const extension = file.name.split('.').pop() ?? 'jpg'
  const path = `${tenantId}/${petId}/foto.${extension}`

  const { error } = await supabase.storage
    .from('pet-photos')
    .upload(path, file, { upsert: true })

  if (error) throw error
  return path
}

/**
 * Como el bucket es privado (CLAUDE.md/migración: nunca público), no hay
 * una URL fija que se pueda poner directo en un `<img src>` — hay que
 * pedirle a Supabase una URL FIRMADA, válida solo un rato (60 segundos
 * aquí, de sobra para que la página termine de cargar la imagen). Cada
 * vez que se muestra la foto se pide una nueva; no se guarda la URL
 * firmada en ningún lado porque caduca.
 */
export async function getPhotoUrl(photoPath: string): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from('pet-photos')
    .createSignedUrl(photoPath, 60)

  if (error) throw error
  return data.signedUrl
}
