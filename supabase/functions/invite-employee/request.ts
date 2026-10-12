// Lógica PURA de invite-employee (sin `Deno.*` ni red): validar el cuerpo del
// request y decidir si un empleado se puede restablecer. Vive en su propio
// archivo, igual que platform-admin/password.ts, para probarla con Vitest
// (supabase/tests/invite-employee-request.spec.ts) en vez de dejarla enterrada
// en el handler HTTP.

export type InviteEmployeeRequest = {
  action: 'invite'
  tenantId: string
  email: string
  fullName: string
}

export type ResetEmployeePasswordRequest = {
  action: 'reset_password'
  tenantId: string
  membershipId: string
}

export type EmployeeRequest = InviteEmployeeRequest | ResetEmployeePasswordRequest

/**
 * Valida el cuerpo. Compatibilidad: sin `action` el cuerpo es el de siempre
 * ("invitar"), así que el frontend anterior a C1.7 sigue funcionando.
 */
export function parseEmployeeRequest(value: unknown): EmployeeRequest | null {
  if (typeof value !== 'object' || value === null) return null
  const { action, tenantId, email, fullName, membershipId } = value as Record<string, unknown>

  if (typeof tenantId !== 'string' || tenantId.length === 0) return null

  if (action === undefined || action === 'invite') {
    if (typeof email !== 'string' || email.trim().length === 0) return null
    if (typeof fullName !== 'string' || fullName.trim().length === 0) return null
    return {
      action: 'invite',
      tenantId,
      email: email.trim().toLowerCase(),
      fullName: fullName.trim(),
    }
  }

  if (action === 'reset_password') {
    if (typeof membershipId !== 'string' || membershipId.length === 0) return null
    return { action: 'reset_password', tenantId, membershipId }
  }

  return null
}

export type ResetTarget = {
  userId: string
  role: string
  isActive: boolean
  isDeleted: boolean
}

export type ResetBlockReason = 'self' | 'owner' | 'inactive'

/**
 * Por qué NO se puede restablecer a este objetivo (o null si sí se puede).
 * Se revisa en este orden: uno mismo, dueño, inactivo/eliminado.
 */
export function resetBlockReason(
  callerUserId: string,
  target: ResetTarget,
): ResetBlockReason | null {
  if (target.userId === callerUserId) return 'self'
  if (target.role === 'owner') return 'owner'
  if (!target.isActive || target.isDeleted) return 'inactive'
  return null
}

export const RESET_BLOCK_MESSAGES: Record<ResetBlockReason, string> = {
  self: 'No puedes restablecer tu propia contraseña desde aquí. Usa "Cambiar contraseña".',
  owner: 'La contraseña del dueño la restablece el equipo de FullPetCare.',
  inactive: 'Este empleado está dado de baja. Actívalo antes de restablecer su contraseña.',
}
