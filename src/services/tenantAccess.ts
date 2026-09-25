import { supabase } from './supabase'
import type { MemberRole } from './memberships'
import type { TenantNoticeKind } from '@/lib/tenantNotices'

/** Aviso de acceso de UN negocio de la persona (tarea #1905). */
export interface TenantNotice {
  tenantId: string
  tenantName: string
  /** Rol de la persona en ese negocio: solo el dueño puede regularizar el pago o cancelar. */
  role: MemberRole
  notice: TenantNoticeKind
  /** Motivo PÚBLICO (del catálogo). null si el aviso es solo por vigencia. */
  publicReason: string | null
  /** Vigencia del plan (ISO). null = indefinida. */
  planExpiresAt: string | null
  /** Fin del periodo de gracia (ISO); null si no hay vigencia. */
  graceEndsAt: string | null
}

/**
 * Avisos de acceso de los negocios donde la persona es miembro: por vencer,
 * en gracia, en solo lectura o dados de baja. La base oculta los dados de baja
 * de todo lo demás; esta RPC (my_tenant_notices) es la única forma de saber
 * cuáles son y por qué, sin abrirle a los negocios la tabla de plataforma.
 */
export async function listMyTenantNotices(): Promise<TenantNotice[]> {
  const { data, error } = await supabase.rpc('my_tenant_notices')
  if (error) throw error

  return (data ?? []).map((row) => ({
    tenantId: row.tenant_id,
    tenantName: row.tenant_name,
    role: row.role,
    notice: row.notice as TenantNoticeKind,
    // La función devuelve null en estos campos, pero el generador de tipos
    // no sabe que una función puede regresar columnas nulas.
    publicReason: (row.public_reason as string | null) ?? null,
    planExpiresAt: (row.plan_expires_at as string | null) ?? null,
    graceEndsAt: (row.grace_ends_at as string | null) ?? null,
  }))
}

/** El dueño da de baja su propio negocio. Solo el superadmin puede reactivarlo. */
export async function cancelMyTenant(
  tenantId: string,
  comment: string | null,
): Promise<void> {
  const { error } = await supabase.rpc('cancel_my_tenant', {
    p_tenant_id: tenantId,
    p_comment: comment as string,
  })
  if (error) throw error
}
