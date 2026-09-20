// Acceso a datos de role_permissions (fase 9). Solo lectura: esta fase no
// construye una pantalla para EDITAR permisos (CLAUDE.md §6.7 — se
// siembra a mano, igual que las tablas de tenencia de la fase 1), así que
// este archivo solo tiene la consulta que necesita la sesión para decidir
// qué mostrar.
import { supabase } from './supabase'
import type { RolePermissionRow } from '@/lib/permissions'

/**
 * Todas las reglas de permisos de un tenant — RLS ya deja ver las de
 * CUALQUIER rol del negocio, no solo el propio (mismo criterio que
 * memberships_select, CLAUDE.md §7.2), así que se piden todas de una vez
 * y lib/permissions.ts#hasPermission() decide localmente con el rol
 * activo, sin una consulta nueva por cada chequeo.
 */
export async function listForTenant(tenantId: string): Promise<RolePermissionRow[]> {
  const { data, error } = await supabase
    .from('role_permissions')
    .select('role, module, can_view, can_edit')
    .eq('tenant_id', tenantId)

  if (error) throw error

  return (data ?? []).map((row) => ({
    role: row.role,
    module: row.module,
    canView: row.can_view,
    canEdit: row.can_edit,
  }))
}
