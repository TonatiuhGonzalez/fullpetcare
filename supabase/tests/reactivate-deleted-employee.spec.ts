// Reactivar a un empleado eliminado al darlo de alta otra vez (PLAN.md D26
// punto 8; migración 20261014160000_reactivate_deleted_employee.sql).
// Antes: delete_employee() dejaba la fila con deleted_at y el unique
// (tenant_id, user_id) hacía que el alta dijera "ya tiene acceso".
import type { PoolClient } from 'pg'
import { afterAll, describe, expect, it } from 'vitest'

import { closePool, setRole, tryQuery, withTransaction } from './helpers'
import {
  BRANCH_CENTRO,
  BRANCH_DEL_VALLE,
  TENANT_HUELLITAS,
  TENANT_PATITAS,
  USER_DUENO,
  USER_GROOMER,
  USER_RECEPCION,
} from './fixtures'

afterAll(closePool)

const HIRE = `select (create_employee_membership($1, $2, $3, $4::uuid[], '1991-02-03', 'CURPNUEVA', 'RFCNUEVO', 'INE999')).id as id`

async function membership(client: PoolClient, userId: string, tenantId = TENANT_PATITAS) {
  const { rows } = await client.query(
    'select id, role, is_active, deleted_at from memberships where user_id = $1 and tenant_id = $2',
    [userId, tenantId],
  )
  return rows[0]
}

/** Elimina al groomer como dueño (sin citas programadas) y deja la sesión como dueño. */
async function fireGroomer(client: PoolClient): Promise<string> {
  await setRole(client, 'service_role')
  await client.query(
    `update appointments set status = 'cancelled' where employee_user_id = $1 and status = 'scheduled'`,
    [USER_GROOMER],
  )
  const { id } = await membership(client, USER_GROOMER)
  await setRole(client, 'authenticated', USER_DUENO)
  await client.query('select delete_employee($1)', [id])
  return id
}

describe('create_employee_membership(): reactivación', () => {
  it('eliminar y volver a dar de alta reactiva la MISMA membresía con rol y sucursales nuevos', async () => {
    // Sin esto, un empleado que se va y regresa no se podría volver a contratar
    // nunca en ese negocio. Se reutiliza la fila (no se inserta otra).
    await withTransaction(async (client) => {
      const id = await fireGroomer(client)
      // Antes tenía Centro; ahora vuelve como vet en Del Valle.
      const { rows } = await client.query(HIRE, [
        TENANT_PATITAS,
        USER_GROOMER,
        'vet',
        [BRANCH_DEL_VALLE],
      ])
      expect(rows[0].id).toBe(id)

      await setRole(client, 'service_role')
      const m = await membership(client, USER_GROOMER)
      expect(m).toMatchObject({ role: 'vet', is_active: true, deleted_at: null })

      const { rows: branches } = await client.query(
        'select branch_id from membership_branches where membership_id = $1 and deleted_at is null',
        [id],
      )
      expect(branches.map((r) => r.branch_id)).toEqual([BRANCH_DEL_VALLE])

      const { rows: det } = await client.query(
        'select curp, rfc, voter_id_number from employee_details where membership_id = $1',
        [id],
      )
      expect(det[0]).toEqual({ curp: 'CURPNUEVA', rfc: 'RFCNUEVO', voter_id_number: 'INE999' })
    })
  })

  it('reactiva una sucursal que ya tenía (borrada suave) sin chocar con el unique', async () => {
    // unique (membership_id, branch_id) incluye borradas: insertar de nuevo
    // Centro fallaría; hay que reactivar la fila.
    await withTransaction(async (client) => {
      const id = await fireGroomer(client)
      await client.query(HIRE, [
        TENANT_PATITAS,
        USER_GROOMER,
        'groomer',
        [BRANCH_CENTRO, BRANCH_DEL_VALLE],
      ])
      await setRole(client, 'service_role')
      const { rows } = await client.query(
        'select branch_id from membership_branches where membership_id = $1 and deleted_at is null order by branch_id',
        [id],
      )
      expect(rows.map((r) => r.branch_id)).toEqual([BRANCH_CENTRO, BRANCH_DEL_VALLE])
    })
  })

  it('queda registrado en la bitácora', async () => {
    // La reactivación es un UPDATE de la membresía: el trigger de auditoría
    // debe dejar old_data con deleted_at y new_data sin él.
    await withTransaction(async (client) => {
      const id = await fireGroomer(client)
      await client.query(HIRE, [TENANT_PATITAS, USER_GROOMER, 'groomer', [BRANCH_CENTRO]])
      await setRole(client, 'service_role')
      const { rows } = await client.query(
        `select old_data->>'deleted_at' as old_deleted, new_data->>'deleted_at' as new_deleted
           from audit_log
          where table_name = 'memberships' and record_id = $1 and action = 'UPDATE'
          order by changed_at desc, id desc limit 1`,
        [id],
      )
      expect(rows[0].old_deleted).not.toBeNull()
      expect(rows[0].new_deleted).toBeNull()
    })
  })

  it('un usuario NO eliminado sigue rechazado', async () => {
    await withTransaction(async (client) => {
      await setRole(client, 'authenticated', USER_DUENO)
      const err = await tryQuery(client, HIRE, [
        TENANT_PATITAS,
        USER_GROOMER,
        'groomer',
        [BRANCH_CENTRO],
      ])
      expect(err).toMatch(/ya tiene acceso/i)
    })
  })

  it('sin permiso employees:edit se rechaza aunque la membresía esté eliminada', async () => {
    await withTransaction(async (client) => {
      await fireGroomer(client)
      await setRole(client, 'authenticated', USER_RECEPCION)
      const err = await tryQuery(client, HIRE, [
        TENANT_PATITAS,
        USER_GROOMER,
        'groomer',
        [BRANCH_CENTRO],
      ])
      expect(err).toMatch(/No tienes permiso/i)
    })
  })

  it('el dueño de otro negocio no puede reactivar', async () => {
    await withTransaction(async (client) => {
      await fireGroomer(client)
      await setRole(client, 'service_role')
      await client.query(
        `update memberships set tenant_id = $1, role = 'owner' where user_id = $2`,
        [TENANT_HUELLITAS, USER_RECEPCION],
      )
      await setRole(client, 'authenticated', USER_RECEPCION)
      const err = await tryQuery(client, HIRE, [
        TENANT_PATITAS,
        USER_GROOMER,
        'groomer',
        [BRANCH_CENTRO],
      ])
      expect(err).toMatch(/No perteneces/i)
    })
  })

  it('anon no puede ejecutarla', async () => {
    await withTransaction(async (client) => {
      await setRole(client, 'anon')
      const err = await tryQuery(client, HIRE, [
        TENANT_PATITAS,
        USER_GROOMER,
        'groomer',
        [BRANCH_CENTRO],
      ])
      expect(err).toMatch(/permission denied/i)
    })
  })

  it('eliminado en el negocio A no se reactiva con un alta en el negocio B', async () => {
    // La búsqueda es por (tenant, usuario): un alta en Huellitas crea una
    // membresía NUEVA allí y deja eliminada la de Patitas.
    await withTransaction(async (client) => {
      const idPatitas = await fireGroomer(client)
      await setRole(client, 'service_role')
      await client.query(
        `update memberships set tenant_id = $1, role = 'owner' where user_id = $2`,
        [TENANT_HUELLITAS, USER_RECEPCION],
      )
      const { rows: b } = await client.query(
        'select id from branches where tenant_id = $1 limit 1',
        [TENANT_HUELLITAS],
      )
      await setRole(client, 'authenticated', USER_RECEPCION)
      const { rows } = await client.query(HIRE, [
        TENANT_HUELLITAS,
        USER_GROOMER,
        'groomer',
        [b[0].id],
      ])
      expect(rows[0].id).not.toBe(idPatitas)

      await setRole(client, 'service_role')
      expect((await membership(client, USER_GROOMER, TENANT_PATITAS)).deleted_at).not.toBeNull()
      expect((await membership(client, USER_GROOMER, TENANT_HUELLITAS)).deleted_at).toBeNull()
    })
  })
})
