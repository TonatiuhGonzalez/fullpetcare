// Trigger que impide dejar un negocio sin dueño activo (Correcciones 1, C1.18, PLAN.md D26;
// migración 20261014170000_protect_last_owner.sql).
//
// Cada test corre en una transacción que se revierte sola (helpers.ts). Se usan UPDATE
// directos, como los hace la pantalla de empleados, porque la regla debe valer en la tabla y
// no solo en la RPC `delete_employee`.
import { afterAll, describe, expect, it } from 'vitest'

import { closePool, setRole, tryQuery, withTransaction } from './helpers'
import { TENANT_PATITAS, USER_DUENO, USER_GROOMER, USER_RECEPCION } from './fixtures'

afterAll(closePool)

const UPDATE_OWNER = (set: string) =>
  `update memberships set ${set} where user_id = $1 and tenant_id = $2`

describe('trigger: no dejar el negocio sin dueño activo', () => {
  it('desactivar al único dueño se rechaza con el motivo claro', async () => {
    // Sin dueño activo nadie puede administrar empleados, sucursales ni facturación y el
    // negocio queda sin remedio desde dentro de la app.
    await withTransaction(async (client) => {
      await setRole(client, 'authenticated', USER_DUENO)
      const error = await tryQuery(client, UPDATE_OWNER('is_active = false'), [
        USER_DUENO,
        TENANT_PATITAS,
      ])
      expect(error).toMatch(/Debe quedar al menos un dueño activo/i)
    })
  })

  it('eliminarlo con deleted_at directo también se rechaza', async () => {
    // La RPC delete_employee ya lo rechazaba; un UPDATE suelto se la saltaba.
    await withTransaction(async (client) => {
      await setRole(client, 'authenticated', USER_DUENO)
      const error = await tryQuery(client, UPDATE_OWNER('deleted_at = now()'), [
        USER_DUENO,
        TENANT_PATITAS,
      ])
      expect(error).toMatch(/Debe quedar al menos un dueño activo/i)
    })
  })

  it('quitarle el rol de dueño al único dueño se rechaza', async () => {
    // Bajarlo a recepción lo dejaría activo pero sin poder de dueño: mismo resultado.
    await withTransaction(async (client) => {
      await setRole(client, 'authenticated', USER_DUENO)
      const error = await tryQuery(client, UPDATE_OWNER(`role = 'receptionist'`), [
        USER_DUENO,
        TENANT_PATITAS,
      ])
      expect(error).toMatch(/Debe quedar al menos un dueño activo/i)
    })
  })

  it('con un segundo dueño activo sí se puede desactivar al primero', async () => {
    // La regla es "al menos uno", no "nunca tocar a un dueño": con relevo, el cambio pasa.
    await withTransaction(async (client) => {
      await setRole(client, 'service_role')
      await client.query(
        `update memberships set role = 'owner' where user_id = $1 and tenant_id = $2`,
        [USER_RECEPCION, TENANT_PATITAS],
      )

      await setRole(client, 'authenticated', USER_RECEPCION)
      const error = await tryQuery(client, UPDATE_OWNER('is_active = false'), [
        USER_DUENO,
        TENANT_PATITAS,
      ])
      expect(error).toBeNull()
    })
  })

  it('un segundo dueño INACTIVO no cuenta como relevo', async () => {
    // Si el "otro dueño" ya está desactivado, el negocio seguiría sin nadie que administre.
    await withTransaction(async (client) => {
      await setRole(client, 'service_role')
      await client.query(
        `update memberships set role = 'owner', is_active = false where user_id = $1 and tenant_id = $2`,
        [USER_RECEPCION, TENANT_PATITAS],
      )

      await setRole(client, 'authenticated', USER_DUENO)
      const error = await tryQuery(client, UPDATE_OWNER('is_active = false'), [
        USER_DUENO,
        TENANT_PATITAS,
      ])
      expect(error).toMatch(/Debe quedar al menos un dueño activo/i)
    })
  })

  it('desactivar a alguien que no es dueño no se ve afectado', async () => {
    // La regla solo vigila a los dueños: dar de baja a un groomer debe seguir funcionando.
    await withTransaction(async (client) => {
      await setRole(client, 'service_role')
      await client.query(
        `update appointments set status = 'cancelled' where employee_user_id = $1 and status = 'scheduled'`,
        [USER_GROOMER],
      )

      await setRole(client, 'authenticated', USER_DUENO)
      const error = await tryQuery(client, UPDATE_OWNER('is_active = false'), [
        USER_GROOMER,
        TENANT_PATITAS,
      ])
      expect(error).toBeNull()
    })
  })

  it('cambiar otra columna del dueño (el rol sigue siendo dueño) no se bloquea', async () => {
    // Un UPDATE que deja al dueño activo y vigente, aunque toque is_active = true, debe pasar.
    await withTransaction(async (client) => {
      await setRole(client, 'authenticated', USER_DUENO)
      const error = await tryQuery(client, UPDATE_OWNER('is_active = true'), [
        USER_DUENO,
        TENANT_PATITAS,
      ])
      expect(error).toBeNull()
    })
  })

  it('delete_employee sigue rechazando al último dueño con su propio mensaje', async () => {
    // La RPC valida antes que el trigger y su mensaje es el que ve la pantalla; si cambiara
    // por el del trigger, el texto de la interfaz cambiaría sin avisar. Aquí recepción, con
    // permiso de editar empleados, intenta eliminar al único dueño.
    await withTransaction(async (client) => {
      const { rows } = await client.query(
        'select id from memberships where user_id = $1 and tenant_id = $2',
        [USER_DUENO, TENANT_PATITAS],
      )
      await setRole(client, 'service_role')
      await client.query(
        `insert into role_permissions (tenant_id, role, module, can_view, can_edit)
         values ($1, 'receptionist', 'employees', true, true)
         on conflict (tenant_id, role, module) do update set can_view = true, can_edit = true`,
        [TENANT_PATITAS],
      )

      await setRole(client, 'authenticated', USER_RECEPCION)
      const error = await tryQuery(client, 'select delete_employee($1)', [rows[0].id])
      expect(error).toMatch(/último dueño/i)
    })
  })
})
