// Configuración de sucursales (tarea #1959, migración branch_settings.sql).
//
// Hasta esta tarea "branches" solo tenía política de SELECT. Ahora el dueño las
// crea, edita y (des)habilita desde la pantalla de configuración. Estos tests
// prueban dos cosas que se rompen en silencio si nadie las vigila:
//   1. QUIÉN puede escribir (solo el dueño), y
//   2. CUÁNDO se puede deshabilitar una sucursal (nunca si todavía se usa).
// La segunda regla vive en un trigger de Postgres, no en la pantalla: así
// aplica aunque alguien llame la API directo saltándose la interfaz.
import { afterAll, describe, expect, it } from 'vitest'
import type { PoolClient } from 'pg'

import { closePool, setRole, withTransaction } from './helpers'
import {
  BRANCH_TIJUANA,
  CUSTOMER_SOFIA,
  PET_ROCKY,
  TENANT_PATITAS,
  USER_DUENO,
  USER_GROOMER,
  USER_RECEPCION,
} from './fixtures'

afterAll(closePool)

// Crea una sucursal nueva como el dueño (igual que hará la pantalla) y
// devuelve su id. Nace sin citas ni empleados: es el caso "libre".
async function createBranchAsOwner(client: PoolClient): Promise<string> {
  await setRole(client, 'authenticated', USER_DUENO)
  const { rows } = await client.query(
    `insert into branches (tenant_id, name, timezone) values ($1, 'Sucursal de prueba', 'America/Tijuana') returning id`,
    [TENANT_PATITAS],
  )
  return rows[0].id
}

describe('branches: quién puede escribir', () => {
  it('el dueño puede crear una sucursal y nace habilitada', async () => {
    // Si fallara, el botón "Añadir sucursal" devolvería un error de
    // permisos al dueño y no podría abrir su segunda sucursal.
    await withTransaction(async (client) => {
      const id = await createBranchAsOwner(client)
      const { rows } = await client.query('select is_active from branches where id = $1', [id])
      expect(rows[0].is_active).toBe(true)
    })
  })

  it('el dueño puede cambiar nombre y horario', async () => {
    await withTransaction(async (client) => {
      const id = await createBranchAsOwner(client)
      const { rowCount } = await client.query(
        `update branches set name = 'Renombrada', opening_hours = '{"monday": {"opensAt": "10:00", "closesAt": "16:00"}}' where id = $1`,
        [id],
      )
      expect(rowCount).toBe(1)
    })
  })

  it('recepción NO puede crear una sucursal', async () => {
    // Sin esta política, cualquier empleado con la API en la mano podría
    // llenar el negocio de sucursales falsas.
    await withTransaction(async (client) => {
      await setRole(client, 'authenticated', USER_RECEPCION)
      await expect(
        client.query(`insert into branches (tenant_id, name) values ($1, 'Intrusa')`, [
          TENANT_PATITAS,
        ]),
      ).rejects.toThrow(/row-level security/i)
    })
  })

  it('un groomer NO puede editar una sucursal (la fila ni siquiera le sale a UPDATE)', async () => {
    // RLS en UPDATE no lanza error: filtra. El resultado correcto es 0 filas.
    await withTransaction(async (client) => {
      await setRole(client, 'authenticated', USER_GROOMER)
      const { rowCount } = await client.query(
        `update branches set name = 'Hackeada' where tenant_id = $1`,
        [TENANT_PATITAS],
      )
      expect(rowCount).toBe(0)
    })
  })
})

describe('branches: deshabilitar y volver a habilitar', () => {
  it('una sucursal libre se puede deshabilitar y volver a habilitar', async () => {
    // El camino feliz: sin citas, sin empleados y con otras sucursales activas.
    await withTransaction(async (client) => {
      const id = await createBranchAsOwner(client)
      await client.query('update branches set is_active = false where id = $1', [id])
      await client.query('update branches set is_active = true where id = $1', [id])
      const { rows } = await client.query('select is_active from branches where id = $1', [id])
      expect(rows[0].is_active).toBe(true)
    })
  })

  it('se bloquea si tiene una cita pendiente a futuro', async () => {
    // Sin este bloqueo, el cliente que ya agendó llegaría a una sucursal que
    // desapareció de la agenda.
    await withTransaction(async (client) => {
      const id = await createBranchAsOwner(client)
      await setRole(client, 'service_role')
      await client.query(
        `insert into appointments (tenant_id, branch_id, customer_id, pet_id, kind, employee_user_id, starts_at, ends_at, created_by)
         values ($1, $2, $3, $4, 'grooming', $5, now() + interval '3 days', now() + interval '3 days' + interval '30 minutes', $5)`,
        [TENANT_PATITAS, id, CUSTOMER_SOFIA, PET_ROCKY, USER_DUENO],
      )
      await setRole(client, 'authenticated', USER_DUENO)
      await expect(
        client.query('update branches set is_active = false where id = $1', [id]),
      ).rejects.toThrow(/citas pendientes/)
    })
  })

  it('NO se bloquea por citas ya pasadas o canceladas', async () => {
    // Bordes: el historial no debe atar a una sucursal para siempre. Una cita
    // cancelada a futuro tampoco es "pendiente".
    await withTransaction(async (client) => {
      const id = await createBranchAsOwner(client)
      await setRole(client, 'service_role')
      await client.query(
        `insert into appointments (tenant_id, branch_id, customer_id, pet_id, kind, employee_user_id, starts_at, ends_at, status, created_by)
         values ($1, $2, $3, $4, 'grooming', $5, now() - interval '3 days', now() - interval '3 days' + interval '30 minutes', 'completed', $5),
                ($1, $2, $3, $4, 'grooming', $5, now() + interval '3 days', now() + interval '3 days' + interval '30 minutes', 'cancelled', $5)`,
        [TENANT_PATITAS, id, CUSTOMER_SOFIA, PET_ROCKY, USER_DUENO],
      )
      await setRole(client, 'authenticated', USER_DUENO)
      const { rowCount } = await client.query(
        'update branches set is_active = false where id = $1',
        [id],
      )
      expect(rowCount).toBe(1)
    })
  })

  it('se bloquea si tiene empleados con acceso asignados', async () => {
    // Sin este bloqueo, un empleado quedaría asignado a una sucursal que no
    // puede usar y su agenda se vería vacía sin explicación.
    await withTransaction(async (client) => {
      const id = await createBranchAsOwner(client)
      await setRole(client, 'service_role')
      await client.query(
        `insert into membership_branches (tenant_id, membership_id, branch_id)
         select tenant_id, id, $2 from memberships where tenant_id = $1 and user_id = $3`,
        [TENANT_PATITAS, id, USER_RECEPCION],
      )
      await setRole(client, 'authenticated', USER_DUENO)
      await expect(
        client.query('update branches set is_active = false where id = $1', [id]),
      ).rejects.toThrow(/empleados asignados/)
    })
  })

  it('se bloquea si es la última sucursal activa del negocio', async () => {
    // Huellitas Spa tiene una sola sucursal. Sin esta regla, el negocio
    // podría quedarse sin ninguna y nadie podría iniciar sesión en la agenda.
    await withTransaction(async (client) => {
      await setRole(client, 'service_role')
      await expect(
        client.query('update branches set is_active = false where id = $1', [BRANCH_TIJUANA]),
      ).rejects.toThrow(/última sucursal activa/)
    })
  })
})
