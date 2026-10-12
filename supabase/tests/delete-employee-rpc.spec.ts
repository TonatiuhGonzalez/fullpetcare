// delete_employee() y el trigger que impide desactivar o eliminar a quien tiene
// citas programadas (Correcciones 1, tarea C1.6, PLAN.md D26; migración
// 20261014150000_delete_employee.sql).
//
// Cada test corre en una transacción que se revierte sola (helpers.ts) y
// arma lo que necesita como service_role. Las pruebas del trigger usan UPDATE
// directo (como lo hace la pantalla de empleados al desactivar), porque la
// regla debe valer para las dos puertas: la RPC y el UPDATE normal.
import type { PoolClient } from 'pg'
import { afterAll, describe, expect, it } from 'vitest'

import { closePool, setRole, tryQuery, withTransaction } from './helpers'
import {
  BRANCH_CENTRO,
  CUSTOMER_SOFIA,
  PET_ROCKY,
  TENANT_HUELLITAS,
  TENANT_PATITAS,
  USER_DUENO,
  USER_GROOMER,
  USER_RECEPCION,
  USER_VET,
} from './fixtures'

afterAll(closePool)

async function membershipId(client: PoolClient, userId: string, tenantId = TENANT_PATITAS) {
  const { rows } = await client.query(
    'select id from memberships where user_id = $1 and tenant_id = $2',
    [userId, tenantId],
  )
  return rows[0].id as string
}

/** Deja al empleado SIN citas programadas (cancela las que la semilla pudiera traer). */
async function clearScheduled(client: PoolClient, userId: string): Promise<void> {
  await client.query(
    `update appointments set status = 'cancelled'
      where employee_user_id = $1 and status = 'scheduled'`,
    [userId],
  )
}

async function addAppointment(
  client: PoolClient,
  userId: string,
  status: string,
  opts: { deleted?: boolean; kind?: 'grooming' | 'veterinary' } = {},
): Promise<void> {
  await client.query(
    `insert into appointments
       (tenant_id, branch_id, customer_id, pet_id, kind, employee_user_id,
        starts_at, ends_at, status, created_by, deleted_at)
     values ($1, $2, $3, $4, $5, $6, now() + interval '3 days',
             now() + interval '3 days' + interval '1 hour', $7::appointment_status, $8,
             case when $9::boolean then now() end)`,
    [
      TENANT_PATITAS,
      BRANCH_CENTRO,
      CUSTOMER_SOFIA,
      PET_ROCKY,
      opts.kind ?? 'grooming',
      userId,
      status,
      USER_DUENO,
      !!opts.deleted,
    ],
  )
}

/** Da a recepción el permiso de editar empleados (se ajusta con una fila, no con código). */
async function grantReceptionEmployeesEdit(client: PoolClient): Promise<void> {
  await client.query(
    `insert into role_permissions (tenant_id, role, module, can_view, can_edit)
     values ($1, 'receptionist', 'employees', true, true)
     on conflict (tenant_id, role, module) do update set can_view = true, can_edit = true`,
    [TENANT_PATITAS],
  )
}

async function callDelete(client: PoolClient, id: string): Promise<string | null> {
  return tryQuery(client, 'select delete_employee($1)', [id])
}

describe('trigger: no desactivar ni eliminar con citas programadas', () => {
  it('desactivar a alguien con citas programadas se rechaza y dice cuántas son', async () => {
    // Una cita programada de alguien sin acceso queda huérfana: nadie la ve en
    // su agenda ni la atenderá. El mensaje con el número le dice a recepción
    // cuántas debe reasignar.
    await withTransaction(async (client) => {
      await setRole(client, 'service_role')
      await clearScheduled(client, USER_GROOMER)
      await addAppointment(client, USER_GROOMER, 'scheduled')
      await addAppointment(client, USER_GROOMER, 'scheduled')

      await setRole(client, 'authenticated', USER_DUENO)
      const error = await tryQuery(
        client,
        'update memberships set is_active = false where user_id = $1 and tenant_id = $2',
        [USER_GROOMER, TENANT_PATITAS],
      )
      expect(error).toMatch(/Tiene 2 citas programadas; reasígnalas o cancélalas primero/i)
    })
  })

  it('con una sola cita el mensaje va en singular', async () => {
    await withTransaction(async (client) => {
      await setRole(client, 'service_role')
      await clearScheduled(client, USER_GROOMER)
      await addAppointment(client, USER_GROOMER, 'scheduled')

      await setRole(client, 'authenticated', USER_DUENO)
      const error = await tryQuery(
        client,
        'update memberships set is_active = false where user_id = $1 and tenant_id = $2',
        [USER_GROOMER, TENANT_PATITAS],
      )
      expect(error).toMatch(/Tiene 1 cita programada;/i)
    })
  })

  it('poner deleted_at directo con citas programadas también se rechaza', async () => {
    // La regla es de la tabla, no solo de la RPC: un UPDATE suelto no la esquiva.
    await withTransaction(async (client) => {
      await setRole(client, 'service_role')
      await clearScheduled(client, USER_GROOMER)
      await addAppointment(client, USER_GROOMER, 'scheduled')

      await setRole(client, 'authenticated', USER_DUENO)
      const error = await tryQuery(
        client,
        'update memberships set deleted_at = now() where user_id = $1 and tenant_id = $2',
        [USER_GROOMER, TENANT_PATITAS],
      )
      expect(error).toMatch(/citas? programadas?/i)
    })
  })

  it('citas completadas, en curso, canceladas, no asistió o eliminadas NO bloquean', async () => {
    // Solo "programada" es trabajo pendiente. Si las demás bloquearan, nadie
    // con historial podría darse de baja nunca.
    await withTransaction(async (client) => {
      await setRole(client, 'service_role')
      await clearScheduled(client, USER_GROOMER)
      for (const status of ['completed', 'in_progress', 'cancelled', 'no_show']) {
        await addAppointment(client, USER_GROOMER, status)
      }
      await addAppointment(client, USER_GROOMER, 'scheduled', { deleted: true })

      await setRole(client, 'authenticated', USER_DUENO)
      const error = await tryQuery(
        client,
        'update memberships set is_active = false where user_id = $1 and tenant_id = $2',
        [USER_GROOMER, TENANT_PATITAS],
      )
      expect(error).toBeNull()
    })
  })

  it('una cita programada de OTRO empleado no bloquea', async () => {
    // El conteo es por empleado: la cita del vet no impide dar de baja al groomer.
    await withTransaction(async (client) => {
      await setRole(client, 'service_role')
      await clearScheduled(client, USER_GROOMER)
      await addAppointment(client, USER_VET, 'scheduled', { kind: 'veterinary' })

      await setRole(client, 'authenticated', USER_DUENO)
      const error = await tryQuery(
        client,
        'update memberships set is_active = false where user_id = $1 and tenant_id = $2',
        [USER_GROOMER, TENANT_PATITAS],
      )
      expect(error).toBeNull()
    })
  })

  it('cambiar el rol o reactivar con citas programadas sigue permitido', async () => {
    // El trigger solo vigila el paso a "sin acceso". Si bloqueara cualquier
    // UPDATE, no se podría ni editar a un empleado ocupado.
    await withTransaction(async (client) => {
      await setRole(client, 'service_role')
      await clearScheduled(client, USER_GROOMER)
      await addAppointment(client, USER_GROOMER, 'scheduled')

      await setRole(client, 'authenticated', USER_DUENO)
      const error = await tryQuery(
        client,
        `update memberships set role = 'groomer', is_active = true where user_id = $1 and tenant_id = $2`,
        [USER_GROOMER, TENANT_PATITAS],
      )
      expect(error).toBeNull()
    })
  })
})

describe('delete_employee()', () => {
  it('sin citas programadas: oculta la membresía y sus sucursales, sin tocar al usuario', async () => {
    await withTransaction(async (client) => {
      await setRole(client, 'service_role')
      await clearScheduled(client, USER_GROOMER)
      const id = await membershipId(client, USER_GROOMER)
      const { rows: before } = await client.query(
        `select count(*)::int as n from membership_branches where membership_id = $1 and deleted_at is null`,
        [id],
      )
      expect(before[0].n).toBeGreaterThan(0)

      await setRole(client, 'authenticated', USER_DUENO)
      expect(await callDelete(client, id)).toBeNull()

      await setRole(client, 'service_role')
      const { rows } = await client.query(
        'select is_active, deleted_at from memberships where id = $1',
        [id],
      )
      expect(rows[0].deleted_at).not.toBeNull()
      expect(rows[0].is_active).toBe(false)

      const { rows: branches } = await client.query(
        `select count(*)::int as n from membership_branches where membership_id = $1 and deleted_at is null`,
        [id],
      )
      expect(branches[0].n).toBe(0)

      // La persona sigue existiendo: es una identidad global (§6.1).
      const { rows: profile } = await client.query('select id from profiles where id = $1', [
        USER_GROOMER,
      ])
      expect(profile).toHaveLength(1)
      // auth.users solo la lee el dueño de la base (service_role no tiene permiso).
      await client.query('reset role')
      const { rows: authUser } = await client.query('select id from auth.users where id = $1', [
        USER_GROOMER,
      ])
      expect(authUser).toHaveLength(1)
    })
  })

  it('con citas programadas se rechaza y no queda nada a medias', async () => {
    // Todo en una transacción: si el trigger rechaza, ni la membresía ni sus
    // sucursales deben haberse tocado.
    await withTransaction(async (client) => {
      await setRole(client, 'service_role')
      await clearScheduled(client, USER_GROOMER)
      await addAppointment(client, USER_GROOMER, 'scheduled')
      const id = await membershipId(client, USER_GROOMER)

      await setRole(client, 'authenticated', USER_DUENO)
      expect(await callDelete(client, id)).toMatch(/Tiene 1 cita programada/i)

      await setRole(client, 'service_role')
      const { rows } = await client.query(
        `select m.deleted_at, m.is_active,
                (select count(*)::int from membership_branches b
                  where b.membership_id = m.id and b.deleted_at is null) as branches
           from memberships m where m.id = $1`,
        [id],
      )
      expect(rows[0].deleted_at).toBeNull()
      expect(rows[0].is_active).toBe(true)
      expect(rows[0].branches).toBeGreaterThan(0)
    })
  })

  it('con citas completadas o canceladas sí se puede', async () => {
    await withTransaction(async (client) => {
      await setRole(client, 'service_role')
      await clearScheduled(client, USER_GROOMER)
      await addAppointment(client, USER_GROOMER, 'completed')
      await addAppointment(client, USER_GROOMER, 'cancelled')
      const id = await membershipId(client, USER_GROOMER)

      await setRole(client, 'authenticated', USER_DUENO)
      expect(await callDelete(client, id)).toBeNull()
    })
  })

  it('nadie se elimina a sí mismo', async () => {
    await withTransaction(async (client) => {
      const id = await membershipId(client, USER_DUENO)
      await setRole(client, 'authenticated', USER_DUENO)
      expect(await callDelete(client, id)).toMatch(/tu propio acceso/i)
    })
  })

  it('no se puede eliminar al último dueño activo', async () => {
    // Se le da a recepción permiso de editar empleados para que SEA otra
    // persona quien intente quitar al único dueño.
    await withTransaction(async (client) => {
      await setRole(client, 'service_role')
      await grantReceptionEmployeesEdit(client)
      await clearScheduled(client, USER_DUENO)
      const id = await membershipId(client, USER_DUENO)

      await setRole(client, 'authenticated', USER_RECEPCION)
      expect(await callDelete(client, id)).toMatch(/último dueño/i)
    })
  })

  it('con otro dueño activo, el primero sí se puede eliminar', async () => {
    // Caso de control del anterior: la regla es "no quedarse sin dueño", no "un
    // dueño nunca se elimina".
    await withTransaction(async (client) => {
      await setRole(client, 'service_role')
      await grantReceptionEmployeesEdit(client)
      await clearScheduled(client, USER_DUENO)
      await client.query(
        `update memberships set role = 'owner' where user_id = $1 and tenant_id = $2`,
        [USER_VET, TENANT_PATITAS],
      )
      const id = await membershipId(client, USER_DUENO)

      await setRole(client, 'authenticated', USER_RECEPCION)
      expect(await callDelete(client, id)).toBeNull()
    })
  })

  it('recepción sin el permiso employees:edit no puede', async () => {
    // Es lo que de verdad protege la RPC: es SECURITY DEFINER (salta RLS), así
    // que sin la revalidación interna cualquier miembro podría eliminar gente.
    await withTransaction(async (client) => {
      await setRole(client, 'service_role')
      await clearScheduled(client, USER_GROOMER)
      const id = await membershipId(client, USER_GROOMER)

      await setRole(client, 'authenticated', USER_RECEPCION)
      expect(await callDelete(client, id)).toMatch(/No tienes permiso/i)
    })
  })

  it('un groomer tampoco', async () => {
    await withTransaction(async (client) => {
      await setRole(client, 'service_role')
      const id = await membershipId(client, USER_VET)
      await setRole(client, 'authenticated', USER_GROOMER)
      expect(await callDelete(client, id)).toMatch(/No tienes permiso/i)
    })
  })

  it('el dueño de otro negocio no puede eliminar empleados de este', async () => {
    // Aislamiento multi-tenant: la membresía de otro tenant se rechaza por
    // pertenencia, aunque la persona sea dueña en SU negocio.
    await withTransaction(async (client) => {
      await setRole(client, 'service_role')
      // El vet pasa a ser el "dueño" de Huellitas y el groomer, su empleado.
      await client.query(
        `update memberships set tenant_id = $1, role = 'owner' where user_id = $2`,
        [TENANT_HUELLITAS, USER_VET],
      )
      const id = await membershipId(client, USER_GROOMER)

      await setRole(client, 'authenticated', USER_VET)
      expect(await callDelete(client, id)).toMatch(/No perteneces/i)
    })
  })

  it('una membresía que no existe o ya está eliminada da un mensaje claro', async () => {
    await withTransaction(async (client) => {
      await setRole(client, 'authenticated', USER_DUENO)
      expect(await callDelete(client, '00000000-0000-4000-8000-0000000000ff')).toMatch(
        /no existe/i,
      )
    })
  })

  it('un visitante sin sesión no puede ejecutarla', async () => {
    await withTransaction(async (client) => {
      const id = await membershipId(client, USER_GROOMER)
      await setRole(client, 'anon')
      expect(await callDelete(client, id)).toMatch(/permission denied/i)
    })
  })

  it('la persona eliminada pierde el acceso y deja de aparecer en la lista de empleados', async () => {
    // Dos consecuencias: (1) app.is_member_of() ya no la reconoce, así que no ve
    // nada del negocio; (2) la consulta de la pantalla de empleados (misma que
    // services/employees.ts list: filtra deleted_at) ya no la trae.
    await withTransaction(async (client) => {
      await setRole(client, 'service_role')
      await clearScheduled(client, USER_GROOMER)
      const id = await membershipId(client, USER_GROOMER)

      await setRole(client, 'authenticated', USER_DUENO)
      expect(await callDelete(client, id)).toBeNull()

      const { rows: list } = await client.query(
        `select id from memberships where tenant_id = $1 and deleted_at is null`,
        [TENANT_PATITAS],
      )
      expect(list.map((r) => r.id)).not.toContain(id)

      await setRole(client, 'authenticated', USER_GROOMER)
      const { rows: customers } = await client.query(
        'select id from customers where tenant_id = $1',
        [TENANT_PATITAS],
      )
      expect(customers).toHaveLength(0)
    })
  })
})
