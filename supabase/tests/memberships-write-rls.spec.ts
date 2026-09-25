// RLS de escritura sobre memberships / membership_branches / profiles
// (fase 9, migración employee_access_rls.sql) — el pendiente que
// rls_tenancy.sql (fase 1, tarea 1.16) dejó anotado: estas tablas
// nacieron con SOLO política de SELECT porque no había pantalla de
// administración todavía. Esta fase la construye, así que aquí se prueba
// que las políticas nuevas de escritura hacen lo que dicen — y, sobre
// todo, que siguen el permiso de la TABLA (app.has_permission), no un rol
// fijo (mismo espíritu que employee-details-rls.spec.ts).
import { afterAll, describe, expect, it } from 'vitest'

import { asUser, closePool, setRole, withTransaction } from './helpers'
import {
  BRANCH_CENTRO,
  TENANT_HUELLITAS,
  TENANT_PATITAS,
  USER_DUENO,
  USER_GROOMER,
  USER_VET,
} from './fixtures'

afterAll(closePool)

describe('memberships: política de INSERT', () => {
  // Mismo truco que ya usa customers-rls.spec.ts/pets-rls.spec.ts para
  // simular "un usuario de otro tenant": en vez de crear un auth.users
  // nuevo a mano (arrastra columnas NOT NULL de Supabase Auth, frágil de
  // mantener), se reasigna a USER_VET a Huellitas — así queda "sin
  // membership en Patitas todavía", listo para un alta de verdad.
  it('el dueño puede dar de alta un membership nuevo en su tenant', async () => {
    await withTransaction(async (client) => {
      await setRole(client, 'service_role')
      await client.query('update memberships set tenant_id = $1 where user_id = $2', [
        TENANT_HUELLITAS,
        USER_VET,
      ])

      await setRole(client, 'authenticated', USER_DUENO)
      const { rows } = await client.query(
        "insert into memberships (tenant_id, user_id, role) values ($1, $2, 'receptionist') returning id",
        [TENANT_PATITAS, USER_VET],
      )
      expect(rows).toHaveLength(1)
    })
  })

  it('un groomer NO puede dar de alta un membership (le falta "employees:edit")', async () => {
    await withTransaction(async (client) => {
      await setRole(client, 'service_role')
      await client.query('update memberships set tenant_id = $1 where user_id = $2', [
        TENANT_HUELLITAS,
        USER_VET,
      ])

      await setRole(client, 'authenticated', USER_GROOMER)
      await expect(
        client.query(
          "insert into memberships (tenant_id, user_id, role) values ($1, $2, 'receptionist')",
          [TENANT_PATITAS, USER_VET],
        ),
      ).rejects.toThrow(/row-level security/i)
    })
  })
})

describe('memberships: política de UPDATE — desactivar corta el acceso al instante', () => {
  it('el dueño puede desactivar (is_active = false) el acceso de un empleado', async () => {
    await withTransaction(async (client) => {
      await setRole(client, 'authenticated', USER_DUENO)
      const { rowCount } = await client.query(
        'update memberships set is_active = false where tenant_id = $1 and user_id = $2',
        [TENANT_PATITAS, USER_VET],
      )
      expect(rowCount).toBe(1)
    })
  })

  it('una vez desactivado, ese usuario deja de ver CUALQUIER cosa de su tenant en la MISMA sesión (CLAUDE.md §7.2)', async () => {
    // Esta es la prueba de que "revocar corta el acceso al instante" no
    // es solo un comentario: no hay que esperar a que caduque ningún
    // token, basta con is_active = false — porque app.is_member_of() lo
    // revisa en cada consulta.
    await withTransaction(async (client) => {
      await setRole(client, 'service_role')
      await client.query('update memberships set is_active = false where tenant_id = $1 and user_id = $2', [
        TENANT_PATITAS,
        USER_VET,
      ])

      await setRole(client, 'authenticated', USER_VET)
      const { rows } = await client.query('select id from branches where tenant_id = $1', [
        TENANT_PATITAS,
      ])
      expect(rows).toHaveLength(0)
    })
  })

  it('un groomer NO puede reactivar/desactivar a otro empleado (le falta "employees:edit")', async () => {
    await withTransaction(async (client) => {
      await setRole(client, 'authenticated', USER_GROOMER)
      const { rowCount } = await client.query(
        'update memberships set is_active = false where tenant_id = $1 and user_id = $2',
        [TENANT_PATITAS, USER_VET],
      )
      // 0 filas, no un error: sin permiso, la fila es invisible para el
      // UPDATE (mismo criterio documentado en customers-rls.spec.ts).
      expect(rowCount).toBe(0)
    })
  })

  it('aislamiento: el dueño de OTRO tenant no puede tocar un membership que no es suyo', async () => {
    await withTransaction(async (client) => {
      await setRole(client, 'service_role')
      await client.query('update memberships set tenant_id = $1, role = $2 where user_id = $3', [
        TENANT_HUELLITAS,
        'owner',
        USER_GROOMER,
      ])

      await setRole(client, 'authenticated', USER_GROOMER)
      const { rowCount } = await client.query(
        'update memberships set role = $1 where tenant_id = $2 and user_id = $3',
        ['owner', TENANT_PATITAS, USER_VET],
      )
      expect(rowCount).toBe(0)
    })
  })
})

describe('membership_branches: política de INSERT/UPDATE', () => {
  it('el dueño puede asignar una sucursal a un empleado', async () => {
    await withTransaction(async (client) => {
      await setRole(client, 'service_role')
      const { rows: membershipRows } = await client.query(
        'select id from memberships where tenant_id = $1 and user_id = $2',
        [TENANT_PATITAS, USER_VET],
      )
      const membershipId = membershipRows[0].id

      await setRole(client, 'authenticated', USER_DUENO)
      const { rows } = await client.query(
        'insert into membership_branches (tenant_id, membership_id, branch_id) values ($1, $2, $3) returning id',
        [TENANT_PATITAS, membershipId, BRANCH_CENTRO],
      )
      expect(rows).toHaveLength(1)
    })
  })

  it('un groomer NO puede asignarse sucursales a sí mismo ni a nadie', async () => {
    await withTransaction(async (client) => {
      await setRole(client, 'service_role')
      const { rows: membershipRows } = await client.query(
        'select id from memberships where tenant_id = $1 and user_id = $2',
        [TENANT_PATITAS, USER_GROOMER],
      )
      const membershipId = membershipRows[0].id

      await setRole(client, 'authenticated', USER_GROOMER)
      await expect(
        client.query(
          'insert into membership_branches (tenant_id, membership_id, branch_id) values ($1, $2, $3)',
          [TENANT_PATITAS, membershipId, BRANCH_CENTRO],
        ),
      ).rejects.toThrow(/row-level security/i)
    })
  })
})

describe('profiles: política de UPDATE nueva', () => {
  it('cualquiera puede editar SU PROPIO nombre', async () => {
    const { rowCount } = await asUser(USER_VET, (c) =>
      c.query('update profiles set full_name = $1 where id = $2', ['Dr. Nuevo Nombre', USER_VET]),
    )
    expect(rowCount).toBe(1)
  })

  it('el dueño puede editar el nombre de un empleado de SU negocio (tiene "employees:edit")', async () => {
    const { rowCount } = await asUser(USER_DUENO, (c) =>
      c.query('update profiles set full_name = $1 where id = $2', ['Nombre Corregido', USER_VET]),
    )
    expect(rowCount).toBe(1)
  })

  it('un groomer NO puede editar el nombre de otro empleado (no tiene "employees:edit")', async () => {
    const { rowCount } = await asUser(USER_GROOMER, (c) =>
      c.query('update profiles set full_name = $1 where id = $2', ['Nombre No Autorizado', USER_VET]),
    )
    expect(rowCount).toBe(0)
  })

  it('el dueño de OTRO tenant no puede editar el nombre de alguien sin membership en su negocio', async () => {
    await withTransaction(async (client) => {
      await setRole(client, 'service_role')
      // El dueño de Huellitas Spa (no existe personal propio en la
      // semilla) se simula reasignando temporalmente al groomer.
      await client.query('update memberships set tenant_id = $1, role = $2 where user_id = $3', [
        TENANT_HUELLITAS,
        'owner',
        USER_GROOMER,
      ])

      await setRole(client, 'authenticated', USER_GROOMER)
      const { rowCount } = await client.query('update profiles set full_name = $1 where id = $2', [
        'Nombre Ajeno',
        USER_VET,
      ])
      expect(rowCount).toBe(0)
    })
  })
})
