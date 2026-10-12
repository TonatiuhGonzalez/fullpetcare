// Acceso a datos de customers. Única capa que habla con Supabase para
// esto (CLAUDE.md §4) — pages/stores nunca importan supabase.ts directo.
import { supabase } from './supabase'
import type { Pet } from './pets'
import type { Database } from '@/types/database'

export type Customer = Database['public']['Tables']['customers']['Row']
export type NewCustomer = Database['public']['Tables']['customers']['Insert']
export type CustomerUpdate = Database['public']['Tables']['customers']['Update']

/**
 * Todos los clientes activos (sin borrado suave) de un tenant, por
 * apellido y luego nombre.
 */
export async function list(tenantId: string): Promise<Customer[]> {
  const { data, error } = await supabase
    .from('customers')
    .select('*')
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .order('last_name')
    .order('first_name')

  if (error) throw error
  return data ?? []
}

/**
 * Busca clientes cuyo nombre, apellido, teléfono O correo EMPIEZA con `term`, sin importar
 * acentos ni mayúsculas ("jose" encuentra "José"; la ñ no se confunde con la n). La
 * comparación la hace la base (`search_customers`, C1.20), así todas las pantallas dicen lo
 * mismo. Cadena vacía o solo espacios devuelve la lista completa, igual que `list()` — así el
 * cuadro de búsqueda puede llamar siempre a `search()`. SECURITY INVOKER: RLS sigue aplicando.
 */
export async function search(tenantId: string, term: string): Promise<Customer[]> {
  const { data, error } = await supabase.rpc('search_customers', {
    p_tenant_id: tenantId,
    p_term: term.trim(),
  })

  if (error) throw error
  return data ?? []
}

/**
 * Un cliente por id, o `null` si no existe o no es de este tenant (RLS
 * lo hace invisible, no lanza error — ver CLAUDE.md §7.1).
 */
export async function getById(tenantId: string, id: string): Promise<Customer | null> {
  const { data, error } = await supabase
    .from('customers')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle()

  if (error) throw error
  return data
}

export async function create(customer: NewCustomer): Promise<Customer> {
  const { data, error } = await supabase
    .from('customers')
    .insert(customer)
    .select()
    .single()

  if (error) throw error
  return data
}

export interface NewCustomerWithPet {
  tenantId: string
  customer: {
    first_name: string
    last_name: string
    phone: string | null
    email: string | null
    notes: string | null
    requires_invoice: boolean
    rfc: string | null
    legal_name: string | null
    tax_regime_code: string | null
    cfdi_use: string | null
    postal_code: string | null
  }
  pet: {
    name: string
    species: Database['public']['Enums']['pet_species']
    breed: string | null
    sex: Database['public']['Enums']['pet_sex'] | null
    birth_date: string | null
    is_sterilized: boolean
    grooming_notes: string | null
    medical_alerts: string | null
  }
}

/**
 * Alta de un cliente CON su mascota en una sola transacción (C1.3, D26): si la mascota es
 * inválida o el correo ya existe, no se guarda nada. La RPC revalida membresía y rol.
 * Lanza el error de Supabase tal cual; `lib/customerErrors.ts` lo traduce para la pantalla.
 */
export async function createWithPet(
  input: NewCustomerWithPet,
): Promise<{ customer: Customer; pet: Pet }> {
  const { customer: c, pet: p } = input
  const { data, error } = await supabase.rpc('create_customer_with_pet', {
    p_tenant_id: input.tenantId,
    p_first_name: c.first_name,
    p_last_name: c.last_name,
    p_phone: c.phone ?? undefined,
    p_email: c.email ?? undefined,
    p_notes: c.notes ?? undefined,
    p_rfc: c.rfc ?? undefined,
    p_legal_name: c.legal_name ?? undefined,
    p_tax_regime_code: c.tax_regime_code ?? undefined,
    p_cfdi_use: c.cfdi_use ?? undefined,
    p_postal_code: c.postal_code ?? undefined,
    p_requires_invoice: c.requires_invoice,
    p_pet_name: p.name,
    p_pet_species: p.species,
    p_pet_breed: p.breed ?? undefined,
    p_pet_sex: p.sex ?? undefined,
    p_pet_birth_date: p.birth_date ?? undefined,
    p_pet_is_sterilized: p.is_sterilized,
    p_pet_grooming_notes: p.grooming_notes ?? undefined,
    p_pet_medical_alerts: p.medical_alerts ?? undefined,
  })

  if (error) throw error
  return data as unknown as { customer: Customer; pet: Pet }
}

export async function update(id: string, changes: CustomerUpdate): Promise<Customer> {
  const { data, error } = await supabase
    .from('customers')
    .update(changes)
    .eq('id', id)
    .select()
    .single()

  if (error) throw error
  return data
}

/**
 * Borrado suave en cascada (CLAUDE.md §8.5, fase 14): la RPC `delete_customer`
 * oculta al cliente, a sus mascotas y a sus citas PROGRAMADAS en una sola
 * transacción. Las demás citas, las ventas y el expediente no se tocan. La
 * tabla no tiene política de DELETE, y un UPDATE suelto no cubriría la cascada.
 */
export async function softDelete(id: string): Promise<void> {
  const { error } = await supabase.rpc('delete_customer', { p_customer_id: id })

  if (error) throw error
}
