// RLS de role_permissions (fase 9, migración role_permissions.sql):
// aislamiento entre tenants, y que NADIE autenticado puede escribir esta
// tabla todavía — mismo patrón que se dejó pendiente para las tablas de
// tenencia en la fase 1 (rls_tenancy.sql, tarea 1.16: "sin política de
// INSERT/UPDATE/DELETE... se siembra a mano"). Si algún día se agrega una
// pantalla para editar permisos, esa tarea trae su propia política y su
// propio test — este archivo confirma que, MIENTRAS TANTO, no hay una
// puerta trasera accidental.
import { afterAll, describe, expect, it } from 'vitest'

import { asUser, closePool, setRole, withTransaction } from './helpers'
import { TENANT_HUELLITAS, TENANT_PATITAS, USER_DUENO, USER_GROOMER } from './fixtures'

afterAll(closePool)

describe('role_permissions: aislamiento entre tenants', () => {
  it('un miembro de OTRO tenant no ve las reglas de permisos de este negocio', async () => {
    // Si esto fallara, cualquier negocio podría ver (y deducir) qué
    // puede hacer cada rol en OTRO negocio — no es información
    // catastrófica, pero sigue siendo del negocio ajeno, y confirma que
    // esta tabla nueva quedó enganchada al mecanismo real de aislamiento
    // (app.is_member_of), no solo copiada de otra migración sin probar.
    await withTransaction(async (client) => {
      await setRole(client, 'service_role')
      await client.query('update memberships set tenant_id = $1 where user_id = $2', [
        TENANT_HUELLITAS,
        USER_GROOMER,
      ])

      await setRole(client, 'authenticated', USER_GROOMER)
      const { rows } = await client.query(
        "select id from role_permissions where tenant_id = $1 and module = 'employees'",
        [TENANT_PATITAS],
      )

      expect(rows).toHaveLength(0)
    })
  })

  it('control: cualquier colega del MISMO tenant sí ve las 4 filas sembradas (owner/receptionist/groomer/vet)', async () => {
    const { rows } = await asUser(USER_DUENO, (c) =>
      c.query("select role from role_permissions where tenant_id = $1 and module = 'employees'", [
        TENANT_PATITAS,
      ]),
    )

    expect(rows).toHaveLength(4)
  })
})

describe('role_permissions: sin política de escritura todavía', () => {
  it('ni siquiera el dueño puede INSERT una regla nueva (no hay pantalla de administración en esta fase)', async () => {
    await withTransaction(async (client) => {
      await setRole(client, 'authenticated', USER_DUENO)
      await expect(
        client.query(
          "insert into role_permissions (tenant_id, role, module, can_view, can_edit) values ($1, 'receptionist', 'employees', true, false)",
          [TENANT_PATITAS],
        ),
      ).rejects.toThrow(/row-level security/i)
    })
  })

  it('ni siquiera el dueño puede UPDATE una regla existente', async () => {
    await withTransaction(async (client) => {
      await setRole(client, 'authenticated', USER_DUENO)
      const { rowCount } = await client.query(
        "update role_permissions set can_view = true where tenant_id = $1 and role = 'groomer' and module = 'employees'",
        [TENANT_PATITAS],
      )
      // 0 filas, no un error — sin política de UPDATE, la fila es
      // invisible para el UPDATE (mismo criterio que el SELECT).
      expect(rowCount).toBe(0)
    })
  })
})
