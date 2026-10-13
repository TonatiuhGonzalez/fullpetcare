// RLS de lectura sobre profiles (migración profiles_select_inactive_members.sql).
//
// Contexto: la política original solo dejaba leer el perfil de quien tuviera una membresía
// ACTIVA. Al desactivar a un empleado, su perfil desaparecía para el resto del negocio y la
// pantalla de Empleados lo mostraba como "(sin nombre)". Estos tests fijan la regla nueva.
import { afterAll, describe, expect, it } from 'vitest'

import { closePool, setRole, withTransaction } from './helpers'
import { TENANT_HUELLITAS, TENANT_PATITAS, USER_DUENO, USER_RECEPCION, USER_VET } from './fixtures'

afterAll(closePool)

// Desde C1.6 la base impide desactivar a quien tiene citas programadas; se cancelan primero
// porque estos tests prueban la lectura del perfil, no esa regla.
async function deactivateVet(client: Parameters<Parameters<typeof withTransaction>[0]>[0]) {
  await setRole(client, 'service_role')
  await client.query(
    "update appointments set status = 'cancelled' where employee_user_id = $1 and status = 'scheduled'",
    [USER_VET],
  )
  await client.query('update memberships set is_active = false where tenant_id = $1 and user_id = $2', [
    TENANT_PATITAS,
    USER_VET,
  ])
}

describe('profiles: política de SELECT', () => {
  it('un empleado desactivado sigue siendo legible para el resto de su negocio', async () => {
    // Qué se rompería: la pantalla de Empleados mostraría "(sin nombre)" en cuanto el dueño
    // desactive a alguien, justo cuando necesita saber a quién desactivó para volver a activarlo.
    await withTransaction(async (client) => {
      await deactivateVet(client)

      await setRole(client, 'authenticated', USER_DUENO)
      const { rows } = await client.query('select full_name from profiles where id = $1', [USER_VET])
      expect(rows).toHaveLength(1)
      expect(rows[0].full_name).toBeTruthy()
    })
  })

  it('otro miembro (recepción) también lo ve: no es un privilegio solo del dueño', async () => {
    // Qué se rompería: que solo el dueño viera el nombre y recepción, en las listas de
    // agenda y citas pasadas, volviera a ver "(sin nombre)" para un empleado desactivado.
    await withTransaction(async (client) => {
      await deactivateVet(client)
      // El lector debe estar activo: otros tests de la suite pueden dejarlo desactivado en la
      // base local, y un lector inactivo no ve nada (esa regla es otra, §7.2).
      await client.query(
        'update memberships set is_active = true where tenant_id = $1 and user_id = $2',
        [TENANT_PATITAS, USER_RECEPCION],
      )

      await setRole(client, 'authenticated', USER_RECEPCION)
      const { rows } = await client.query('select id from profiles where id = $1', [USER_VET])
      expect(rows).toHaveLength(1)
    })
  })

  it('un empleado eliminado (borrado suave) NO expone su perfil', async () => {
    // Qué se rompería: eliminar a alguien dejaría su nombre y teléfono visibles para siempre.
    // Quitar `is_active` de la política no debe relajar la regla de `deleted_at`.
    await withTransaction(async (client) => {
      await setRole(client, 'service_role')
      await client.query(
        "update appointments set status = 'cancelled' where employee_user_id = $1 and status = 'scheduled'",
        [USER_VET],
      )
      await client.query(
        'update memberships set is_active = false, deleted_at = now() where tenant_id = $1 and user_id = $2',
        [TENANT_PATITAS, USER_VET],
      )

      await setRole(client, 'authenticated', USER_DUENO)
      const { rows } = await client.query('select id from profiles where id = $1', [USER_VET])
      expect(rows).toHaveLength(0)
    })
  })

  it('un empleado desactivado de OTRO negocio sigue sin ser visible', async () => {
    // Qué se rompería: el aislamiento entre negocios. Quitar `is_active` no debe abrir los
    // perfiles de personas que pertenecen a un negocio al que quien consulta no pertenece.
    await withTransaction(async (client) => {
      await setRole(client, 'service_role')
      await client.query(
        "update appointments set status = 'cancelled' where employee_user_id = $1 and status = 'scheduled'",
        [USER_VET],
      )
      await client.query(
        'update memberships set tenant_id = $1, is_active = false where user_id = $2',
        [TENANT_HUELLITAS, USER_VET],
      )

      await setRole(client, 'authenticated', USER_DUENO)
      const { rows } = await client.query('select id from profiles where id = $1', [USER_VET])
      expect(rows).toHaveLength(0)
    })
  })
})
