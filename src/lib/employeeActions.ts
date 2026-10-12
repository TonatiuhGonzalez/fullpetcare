// Reglas de la columna "Acciones" de la pantalla de empleados (C1.18).
// Funciones puras: reciben a la persona de la fila y a toda la lista, y
// regresan qué botones aplican. La base repite estas reglas (delete_employee(),
// la Edge Function invite-employee): esto solo evita mostrar un botón que se
// va a rechazar, igual que lib/roles.ts.
//
// Lo que no aplica se OCULTA, no se deshabilita: un botón apagado sin
// explicación confunde ("¿por qué no me deja?") y la fila no tiene lugar para
// el motivo. El único rechazo que no se puede saber de antemano es el de las
// citas programadas (necesita consultar citas); ese lo explica el mensaje que
// devuelve la base al intentarlo.
import type { MemberRole } from '@/services/memberships'

export interface EmployeeActionTarget {
  membershipId: string
  userId: string
  role: MemberRole
  isActive: boolean
}

export interface EmployeeActionSet {
  /** Editar siempre aplica a quien puede gestionar empleados. */
  canEdit: boolean
  /** Qué hace el botón de acceso: desactivar, activar, o ninguno. */
  toggleActive: 'deactivate' | 'activate' | null
  canDelete: boolean
  canResetPassword: boolean
}

/** true si, sin esta persona, queda al menos un dueño activo en el negocio. */
function hasAnotherActiveOwner(
  target: EmployeeActionTarget,
  all: readonly EmployeeActionTarget[],
): boolean {
  return all.some(
    (m) => m.membershipId !== target.membershipId && m.role === 'owner' && m.isActive,
  )
}

export function employeeActionsFor(
  target: EmployeeActionTarget,
  all: readonly EmployeeActionTarget[],
  currentUserId: string | null,
): EmployeeActionSet {
  const isSelf = currentUserId !== null && target.userId === currentUserId
  // Quitarle el acceso a un dueño solo se permite si queda otro: un negocio
  // sin dueño activo no tiene quién administre empleados ni sucursales.
  const isLastOwner = target.role === 'owner' && !hasAnotherActiveOwner(target, all)

  let toggleActive: EmployeeActionSet['toggleActive'] = null
  if (!target.isActive) {
    // Reactivar no quita acceso a nadie: no tiene reglas más allá de la fila.
    toggleActive = 'activate'
  } else if (!isSelf && !isLastOwner) {
    toggleActive = 'deactivate'
  }

  return {
    canEdit: true,
    toggleActive,
    canDelete: !isSelf && !isLastOwner,
    // La función del servidor responde 409 a uno mismo, a un dueño y a un
    // empleado inactivo.
    canResetPassword: !isSelf && target.role !== 'owner' && target.isActive,
  }
}

const SCHEDULED_HINT = 'employee_has_scheduled_appointments'

/**
 * Mensaje en español para un error de desactivar / eliminar. La base ya manda
 * en español lo que la persona puede corregir (citas programadas, último
 * dueño, uno mismo, sin permiso); el resto (red, RLS, restricciones en
 * inglés) se reemplaza por `fallback` (CLAUDE.md §5.4).
 */
export function friendlyEmployeeActionMessage(
  error: { code?: string; message?: string; hint?: string | null } | null | undefined,
  fallback: string,
): string {
  if (!error || typeof error.message !== 'string' || error.message.trim() === '')
    return fallback
  if (error.hint === SCHEDULED_HINT) return error.message

  // check_violation (23514), insufficient_privilege (42501) y no_data_found
  // (P0002) son los que lanzan nuestras funciones con texto en español.
  const isOurs =
    error.code === '23514' || error.code === '42501' || error.code === 'P0002'
  // Un 23514 / 42501 de la propia tabla (check constraint, RLS) viene en inglés.
  const isTechnical = /row-level security|violates|constraint|relation/i.test(
    error.message,
  )
  return isOurs && !isTechnical ? error.message : fallback
}
