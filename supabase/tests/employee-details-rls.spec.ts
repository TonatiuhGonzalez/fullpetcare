// RLS de employee_details (fase 9): quién puede ver/editar los datos
// personales de un empleado. La regla real NO está hardcodeada a "owner"
// en la política — está en app.has_permission(), que a su vez lee
// role_permissions. Este archivo prueba dos cosas distintas a propósito:
// (1) el comportamiento de HOY (semilla: solo owner tiene
// can_view/can_edit) y (2) que cambiar SOLO una fila de role_permissions
// —sin tocar ninguna política ni ningún código— cambia el resultado. Ese
// segundo bloque es la prueba real de que "a futuro se pueden modificar
// los permisos sin retocar código" (CLAUDE.md §6.7) no es solo un
// enunciado del plan, es un comportamiento verificado.
import { afterAll, describe, expect, it } from 'vitest'
import type { PoolClient } from 'pg'

import { closePool, setRole, withTransaction } from './helpers'
import {
  TENANT_HUELLITAS,
  TENANT_PATITAS,
  USER_DUENO,
  USER_GROOMER,
  USER_RECEPCION,
  USER_VET,
} from './fixtures'

afterAll(closePool)

/** El membership del dueño ya existe en la semilla — se reutiliza para colgarle employee_details. */
async function seedEmployeeDetails(client: PoolClient): Promise<string> {
  await setRole(client, 'service_role')
  const { rows: membershipRows } = await client.query(
    'select id from memberships where tenant_id = $1 and user_id = $2',
    [TENANT_PATITAS, USER_RECEPCION],
  )
  const membershipId = membershipRows[0].id

  const { rows } = await client.query(
    `insert into employee_details (tenant_id, membership_id, birth_date, curp, rfc, voter_id_number)
     values ($1, $2, '1994-03-10', 'RECX940310MDFAAA01', 'RECX940310AB2', '9876543210987')
     returning id`,
    [TENANT_PATITAS, membershipId],
  )
  return rows[0].id
}

describe('employee_details: hoy, solo el dueño ve/edita (semilla real)', () => {
  it('el dueño SÍ ve la ficha de un empleado de su negocio', async () => {
    await withTransaction(async (client) => {
      const id = await seedEmployeeDetails(client)

      await setRole(client, 'authenticated', USER_DUENO)
      const { rows } = await client.query('select curp from employee_details where id = $1', [id])

      expect(rows).toHaveLength(1)
      expect(rows[0].curp).toBe('RECX940310MDFAAA01')
    })
  })

  it('un groomer NO ve la ficha de un empleado (su rol no tiene "employees:view" hoy)', async () => {
    // Este es el caso que de verdad importa: sin esto, cualquier
    // empleado con sesión podría leer el CURP y el RFC de sus colegas —
    // datos personales sensibles que la pestaña dice reservar al dueño.
    await withTransaction(async (client) => {
      const id = await seedEmployeeDetails(client)

      await setRole(client, 'authenticated', USER_GROOMER)
      const { rows } = await client.query('select id from employee_details where id = $1', [id])

      expect(rows).toHaveLength(0)
    })
  })

  it('un groomer NO puede insertar una ficha nueva (falta "employees:edit")', async () => {
    await withTransaction(async (client) => {
      await setRole(client, 'service_role')
      const { rows: membershipRows } = await client.query(
        'select id from memberships where tenant_id = $1 and user_id = $2',
        [TENANT_PATITAS, USER_VET],
      )
      const membershipId = membershipRows[0].id

      await setRole(client, 'authenticated', USER_GROOMER)
      await expect(
        client.query(
          `insert into employee_details (tenant_id, membership_id, birth_date, curp, rfc, voter_id_number)
           values ($1, $2, '1990-01-01', 'VETX900101HDFAAA02', 'VETX900101AB3', '1112223334445')`,
          [TENANT_PATITAS, membershipId],
        ),
      ).rejects.toThrow(/row-level security/i)
    })
  })
})

describe('employee_details: aislamiento entre tenants', () => {
  it('un miembro de OTRO tenant no ve la ficha, aunque conozca el id', async () => {
    await withTransaction(async (client) => {
      const id = await seedEmployeeDetails(client)

      await setRole(client, 'service_role')
      await client.query('update memberships set tenant_id = $1, role = $2 where user_id = $3', [
        TENANT_HUELLITAS,
        'owner',
        USER_GROOMER,
      ])

      await setRole(client, 'authenticated', USER_GROOMER)
      const { rows } = await client.query('select id from employee_details where id = $1', [id])

      expect(rows).toHaveLength(0)
    })
  })
})

describe('employee_details: el permiso sigue la TABLA, no un rol hardcodeado', () => {
  it('si role_permissions le da "employees:view" a receptionist, empieza a ver la ficha SIN tocar ninguna política', async () => {
    await withTransaction(async (client) => {
      const id = await seedEmployeeDetails(client)

      // Antes del cambio: recepción no ve nada (semilla real, false/false).
      await setRole(client, 'authenticated', USER_RECEPCION)
      const before = await client.query('select id from employee_details where id = $1', [id])
      expect(before.rows).toHaveLength(0)

      // Cambia UNA fila de datos — cero SQL de políticas, cero código.
      await setRole(client, 'service_role')
      await client.query(
        "update role_permissions set can_view = true where tenant_id = $1 and role = 'receptionist' and module = 'employees'",
        [TENANT_PATITAS],
      )

      await setRole(client, 'authenticated', USER_RECEPCION)
      const after = await client.query('select id from employee_details where id = $1', [id])
      expect(after.rows).toHaveLength(1)
    })
  })
})
