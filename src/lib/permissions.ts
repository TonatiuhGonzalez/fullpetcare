// Permisos por rol y módulo, para la UI (fase 9, CLAUDE.md §6.7). Mismo
// espíritu que lib/roles.ts: función pura, "para no mostrar un botón o
// una pestaña que el backend igual va a rechazar" — la autoridad real es
// la política RLS + la función app.has_permission() en Postgres
// (migración role_permissions.sql), no este archivo. Si algún día
// alguien cambia una regla aquí sin cambiarla también en la base, el peor
// caso es una pestaña visible que el backend rechaza igual — nunca un
// hueco de seguridad, porque este archivo nunca decide qué datos
// entrega el servidor.
import type { MemberRole } from '@/services/memberships'
import type { Database } from '@/types/database'

export type PermissionModule = Database['public']['Enums']['permission_module']
export type PermissionAction = 'view' | 'edit'

export interface RolePermissionRow {
  role: MemberRole
  module: PermissionModule
  canView: boolean
  canEdit: boolean
}

/**
 * true si `role` puede hacer `action` sobre `module`, según las reglas de
 * `rows` (las filas de role_permissions del tenant activo). "owner"
 * siempre puede todo, sin necesidad de que exista una fila para él
 * (CLAUDE.md §6.1, "Puede: Todo") — mismo bypass que app.has_permission()
 * en la base. Sin rol (nadie ha elegido negocio todavía) o sin una fila
 * que corresponda, el default es "no".
 */
export function hasPermission(
  role: MemberRole | null,
  rows: RolePermissionRow[],
  module: PermissionModule,
  action: PermissionAction,
): boolean {
  if (role === 'owner') return true
  if (role === null) return false

  const row = rows.find((r) => r.role === role && r.module === module)
  if (!row) return false

  return action === 'view' ? row.canView : row.canEdit
}
