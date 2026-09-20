// Tests de lib/permissions.ts (fase 9) — la versión "para la UI" de
// app.has_permission(). El caso que de verdad importa es el último: que
// el resultado dependa de la FILA de datos, no de un `if (role ===
// 'owner')` copiado y pegado en cada pantalla — es la prueba de que "a
// futuro se pueden modificar los permisos sin tocar código" (CLAUDE.md
// §6.7) también es cierto del lado del frontend, no solo en Postgres.
import { describe, expect, it } from 'vitest'

import { hasPermission, type RolePermissionRow } from './permissions'

const ROWS: RolePermissionRow[] = [
  { role: 'receptionist', module: 'employees', canView: true, canEdit: false },
  { role: 'groomer', module: 'employees', canView: false, canEdit: false },
]

describe('hasPermission', () => {
  it('owner siempre puede, aunque no haya ninguna fila para él', () => {
    expect(hasPermission('owner', [], 'employees', 'view')).toBe(true)
    expect(hasPermission('owner', [], 'employees', 'edit')).toBe(true)
  })

  it('sin rol (todavía no se elige negocio), no hay permiso', () => {
    expect(hasPermission(null, ROWS, 'employees', 'view')).toBe(false)
  })

  it('un rol con can_view=true pero can_edit=false puede ver, no editar', () => {
    expect(hasPermission('receptionist', ROWS, 'employees', 'view')).toBe(true)
    expect(hasPermission('receptionist', ROWS, 'employees', 'edit')).toBe(false)
  })

  it('un rol sin fila para ese módulo no tiene permiso (default: no)', () => {
    expect(hasPermission('vet', ROWS, 'employees', 'view')).toBe(false)
  })

  it('un rol con can_view=false explícito no tiene permiso, aunque exista la fila', () => {
    expect(hasPermission('groomer', ROWS, 'employees', 'view')).toBe(false)
  })

  it('cambiar SOLO los datos (sin tocar código) cambia el resultado', () => {
    // Esta es la prueba real de la promesa central de la fase 9: el
    // mismo rol, la misma llamada, dos resultados distintos porque
    // cambió una fila de datos — no una función.
    const before = hasPermission('receptionist', ROWS, 'employees', 'edit')
    const updatedRows = ROWS.map((r) =>
      r.role === 'receptionist' ? { ...r, canEdit: true } : r,
    )
    const after = hasPermission('receptionist', updatedRows, 'employees', 'edit')

    expect(before).toBe(false)
    expect(after).toBe(true)
  })
})
