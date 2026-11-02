// Acceso a datos de familias de clientes (fase 31, PLAN.md D30). Único archivo que habla con
// Supabase para esto (CLAUDE.md §4). Las familias NO se escriben con insert/update: lo hacen
// las RPC `save_family` y `delete_family`, que mantienen sus reglas en una transacción.
import { supabase } from './supabase'
import type { Database } from '@/types/database'

export type Family = Database['public']['Tables']['families']['Row']

export interface FamilyMember {
  customerId: string
  name: string
  isHolder: boolean
}

export interface FamilyWithMembers {
  family: Family
  members: FamilyMember[]
}

/** La familia a la que pertenece un cliente, con sus miembros; nulo si no tiene. */
export async function getByCustomer(
  tenantId: string,
  customerId: string,
): Promise<FamilyWithMembers | null> {
  const { data: membership, error: membershipError } = await supabase
    .from('family_members')
    .select('family_id')
    .eq('tenant_id', tenantId)
    .eq('customer_id', customerId)
    .is('deleted_at', null)
    .maybeSingle()
  if (membershipError) throw membershipError
  if (!membership) return null

  const [familyResult, membersResult] = await Promise.all([
    supabase.from('families').select('*').eq('id', membership.family_id).single(),
    supabase
      .from('family_members')
      .select('customer_id, is_holder, customers ( first_name, last_name )')
      .eq('family_id', membership.family_id)
      .is('deleted_at', null),
  ])
  if (familyResult.error) throw familyResult.error
  if (membersResult.error) throw membersResult.error

  const members = (membersResult.data ?? [])
    .map((row) => ({
      customerId: row.customer_id,
      name: row.customers
        ? `${row.customers.first_name} ${row.customers.last_name}`.trim()
        : '',
      isHolder: row.is_holder,
    }))
    // El titular primero, luego por nombre.
    .sort(
      (a, b) =>
        Number(b.isHolder) - Number(a.isHolder) || a.name.localeCompare(b.name, 'es'),
    )

  return { family: familyResult.data, members }
}

export interface SaveFamilyInput {
  name: string
  holderCustomerId: string
  memberCustomerIds: string[]
}

/** Crea (sin `familyId`) o corrige una familia. Devuelve su id. */
export async function save(
  tenantId: string,
  familyId: string | null,
  input: SaveFamilyInput,
): Promise<string> {
  const { data, error } = await supabase.rpc('save_family', {
    p_tenant_id: tenantId,
    // La base acepta NULL (familia nueva); los tipos generados marcan todo como obligatorio.
    p_family_id: familyId as string,
    p_name: input.name,
    p_holder_customer_id: input.holderCustomerId,
    p_member_customer_ids: input.memberCustomerIds,
  })

  if (error) throw error
  return data
}

/** Disuelve una familia: sus miembros quedan libres; clientes y mascotas no se tocan. */
export async function remove(familyId: string): Promise<void> {
  const { error } = await supabase.rpc('delete_family', { p_family_id: familyId })

  if (error) throw error
}
