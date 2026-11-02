// Vínculo de un cliente con su cuenta de dueño (fase 16B, PLAN.md D31), visto por el personal.
// Único archivo del lado del personal que habla con `customer_accounts`. El personal solo
// sabe SI hay una cuenta vinculada y puede desvincularla; nunca ve el correo ni su sesión.
import { supabase } from './supabase'

/** ¿Este cliente tiene una cuenta vinculada y vigente? */
export async function hasLinkedAccount(
  tenantId: string,
  customerId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from('customer_accounts')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('customer_id', customerId)
    .is('unlinked_at', null)
    .maybeSingle()
  if (error) throw error
  return data !== null
}

/** Corta el vínculo: la persona deja de ver a sus mascotas en su cuenta (dueño y recepción). */
export async function unlink(customerId: string): Promise<void> {
  const { error } = await supabase.rpc('unlink_customer_account', {
    p_customer_id: customerId,
  })
  if (error) throw error
}
