// Prueba delete_customer() y delete_pet() (fase 14, tarea 14.2 / PLAN.md D19):
// el borrado suave en cascada que dispara la tabla de Clientes.
//
// Mismo patrón que checkout-products-rpc.spec.ts: sesión simulada con pg dentro
// de una transacción que siempre se revierte, así ningún test deja rastro.
import { afterAll, describe, expect, it } from 'vitest'
import type { PoolClient } from 'pg'

import { closePool, setRole, withTransaction } from './helpers'
import {
  BRANCH_CENTRO,
  BRANCH_DEL_VALLE,
  CUSTOMER_FERNANDA,
  CUSTOMER_SOFIA,
  NONEXISTENT_UUID,
  PET_MICHI,
  PET_ROCKY,
  TENANT_PATITAS,
  USER_DUENO,
  USER_GROOMER,
  USER_RECEPCION,
  USER_VET,
  VACCINE_RABIA,
} from './fixtures'

afterAll(closePool)

/** Crea una cita saltándose RLS (solo arma el escenario) y devuelve su id. */
async function insertAppointment(
  client: PoolClient,
  petId: string,
  status: string,
  daysAhead: number,
  branchId = BRANCH_CENTRO,
): Promise<string> {
  await setRole(client, 'service_role')
  const { rows } = await client.query(
    `insert into appointments (tenant_id, branch_id, customer_id, pet_id, kind, employee_user_id, starts_at, ends_at, status, created_by)
     select $1, $2, p.customer_id, p.id, 'grooming', $3,
            now() + make_interval(days => $5), now() + make_interval(days => $5) + interval '30 minutes', $6::appointment_status, $4
       from pets p where p.id = $7
     returning id`,
    [TENANT_PATITAS, branchId, USER_GROOMER, USER_DUENO, daysAhead, status, petId],
  )
  return rows[0].id
}

/** Lee deleted_at de una fila como service_role (para ver también lo oculto). */
async function isDeleted(client: PoolClient, table: string, id: string): Promise<boolean> {
  await setRole(client, 'service_role')
  const { rows } = await client.query(`select deleted_at from ${table} where id = $1`, [id])
  return rows[0].deleted_at !== null
}

describe('delete_pet()', () => {
  it('oculta la mascota y sus citas programadas, y conserva las demás', async () => {
    // Es el corazón de la regla: solo lo PENDIENTE se borra. Si también se
    // ocultara una cita completada, el historial de la mascota (y su expediente
    // ligado a esa cita) quedaría sin visita visible.
    await withTransaction(async (client) => {
      const scheduled = await insertAppointment(client, PET_ROCKY, 'scheduled', 5)
      const inProgress = await insertAppointment(client, PET_ROCKY, 'in_progress', 6)
      const completed = await insertAppointment(client, PET_ROCKY, 'completed', 7)
      const cancelled = await insertAppointment(client, PET_ROCKY, 'cancelled', 8)

      await setRole(client, 'authenticated', USER_RECEPCION)
      await client.query('select delete_pet($1)', [PET_ROCKY])

      expect(await isDeleted(client, 'pets', PET_ROCKY)).toBe(true)
      expect(await isDeleted(client, 'appointments', scheduled)).toBe(true)
      expect(await isDeleted(client, 'appointments', inProgress)).toBe(false)
      expect(await isDeleted(client, 'appointments', completed)).toBe(false)
      expect(await isDeleted(client, 'appointments', cancelled)).toBe(false)
    })
  })

  it('no toca a las otras mascotas del mismo cliente', async () => {
    // Si el UPDATE filtrara por cliente en vez de por mascota, eliminar a Rocky
    // se llevaría también a Michi y sus citas.
    await withTransaction(async (client) => {
      const michiAppointment = await insertAppointment(client, PET_MICHI, 'scheduled', 5)

      await setRole(client, 'authenticated', USER_DUENO)
      await client.query('select delete_pet($1)', [PET_ROCKY])

      expect(await isDeleted(client, 'pets', PET_MICHI)).toBe(false)
      expect(await isDeleted(client, 'appointments', michiAppointment)).toBe(false)
    })
  })

  it('no borra el expediente de la mascota', async () => {
    // El expediente es un documento legal (§8.5) y no tiene deleted_at: eliminar la
    // mascota solo la oculta, nunca debe tocar sus registros. Se CREA un expediente
    // antes (la semilla no trae uno para Rocky); sin eso el test compararía 0 con 0.
    await withTransaction(async (client) => {
      const completed = await insertAppointment(client, PET_ROCKY, 'completed', -2)
      await setRole(client, 'service_role')
      await client.query(
        'insert into grooming_records (tenant_id, appointment_id, pet_id) values ($1, $2, $3)',
        [TENANT_PATITAS, completed, PET_ROCKY],
      )
      await client.query(
        'insert into vaccinations (tenant_id, pet_id, vaccine_id) values ($1, $2, $3)',
        [TENANT_PATITAS, PET_ROCKY, VACCINE_RABIA],
      )

      await setRole(client, 'authenticated', USER_DUENO)
      await client.query('select delete_pet($1)', [PET_ROCKY])

      await setRole(client, 'service_role')
      const { rows } = await client.query(
        `select (select count(*) from grooming_records where pet_id = $1)::int as grooming,
                (select count(*) from vaccinations where pet_id = $1)::int as vaccines`,
        [PET_ROCKY],
      )
      expect(rows[0]).toEqual({ grooming: 1, vaccines: 1 })
    })
  })

  it.each([
    ['groomer', USER_GROOMER],
    ['vet', USER_VET],
  ])('rechaza al %s', async (_name, userId) => {
    // Solo dueño y recepción administran clientes (§6.1). SECURITY DEFINER salta
    // RLS: sin la revisión de rol dentro de la función, cualquiera con sesión
    // podría borrar mascotas llamando a la RPC directo.
    await withTransaction(async (client) => {
      await setRole(client, 'authenticated', userId)
      await expect(client.query('select delete_pet($1)', [PET_ROCKY])).rejects.toThrow(/permiso/i)
    })
  })

  it('rechaza una mascota de otro negocio', async () => {
    // Aislamiento multi-tenant: la dueña de Patitas no puede eliminar mascotas de
    // Huellitas aunque conozca el id. Se usa una mascota de Huellitas.
    await withTransaction(async (client) => {
      await setRole(client, 'service_role')
      const { rows } = await client.query(
        'select id from pets where tenant_id <> $1 and deleted_at is null limit 1',
        [TENANT_PATITAS],
      )
      await setRole(client, 'authenticated', USER_DUENO)
      await expect(client.query('select delete_pet($1)', [rows[0].id])).rejects.toThrow(
        /no perteneces/i,
      )
    })
  })

  it('rechaza una mascota que no existe', async () => {
    await withTransaction(async (client) => {
      await setRole(client, 'authenticated', USER_DUENO)
      await expect(client.query('select delete_pet($1)', [NONEXISTENT_UUID])).rejects.toThrow(
        /no existe/i,
      )
    })
  })

  it('el anónimo no puede ejecutarla', async () => {
    // Sin el revoke, PUBLIC (y por tanto anon) tendría EXECUTE por defecto.
    await withTransaction(async (client) => {
      await setRole(client, 'anon')
      await expect(client.query('select delete_pet($1)', [PET_ROCKY])).rejects.toThrow(
        /permission denied/i,
      )
    })
  })
})

describe('delete_customer()', () => {
  it('oculta al cliente, a sus mascotas y sus citas programadas de cualquier sucursal', async () => {
    // Recepción solo entra a ciertas sucursales, pero el cliente es de todo el
    // negocio: sus citas programadas en otra sucursal también deben ocultarse,
    // o quedarían citas vivas de un cliente que ya no existe.
    await withTransaction(async (client) => {
      const inCentro = await insertAppointment(client, PET_ROCKY, 'scheduled', 5, BRANCH_CENTRO)
      const inValle = await insertAppointment(client, PET_MICHI, 'scheduled', 6, BRANCH_DEL_VALLE)
      const completed = await insertAppointment(client, PET_ROCKY, 'completed', 7)

      await setRole(client, 'authenticated', USER_RECEPCION)
      await client.query('select delete_customer($1)', [CUSTOMER_SOFIA])

      expect(await isDeleted(client, 'customers', CUSTOMER_SOFIA)).toBe(true)
      expect(await isDeleted(client, 'pets', PET_ROCKY)).toBe(true)
      expect(await isDeleted(client, 'pets', PET_MICHI)).toBe(true)
      expect(await isDeleted(client, 'appointments', inCentro)).toBe(true)
      expect(await isDeleted(client, 'appointments', inValle)).toBe(true)
      expect(await isDeleted(client, 'appointments', completed)).toBe(false)
    })
  })

  it('no toca a otros clientes', async () => {
    // Un WHERE mal armado en la cascada borraría mascotas de todo el negocio.
    await withTransaction(async (client) => {
      await setRole(client, 'authenticated', USER_DUENO)
      await client.query('select delete_customer($1)', [CUSTOMER_SOFIA])

      await setRole(client, 'service_role')
      const { rows } = await client.query(
        `select count(*)::int as n from pets
          where tenant_id = $1 and customer_id <> $2 and deleted_at is null`,
        [TENANT_PATITAS, CUSTOMER_SOFIA],
      )
      expect(rows[0].n).toBeGreaterThan(0)
    })
  })

  it('después de eliminarlo, ya no aparece en su lista (RLS + deleted_at)', async () => {
    // Comprueba la trampa de §7.2: el UPDATE de deleted_at no debe chocar con la
    // política de SELECT, y la base debe conservar la fila (solo oculta).
    await withTransaction(async (client) => {
      await setRole(client, 'authenticated', USER_DUENO)
      await client.query('select delete_customer($1)', [CUSTOMER_SOFIA])

      const { rows } = await client.query(
        'select id from customers where id = $1 and deleted_at is null',
        [CUSTOMER_SOFIA],
      )
      expect(rows).toHaveLength(0)
      expect(await isDeleted(client, 'customers', CUSTOMER_SOFIA)).toBe(true)
    })
  })

  it.each([
    ['groomer', USER_GROOMER],
    ['vet', USER_VET],
  ])('rechaza al %s', async (_name, userId) => {
    await withTransaction(async (client) => {
      await setRole(client, 'authenticated', userId)
      await expect(client.query('select delete_customer($1)', [CUSTOMER_SOFIA])).rejects.toThrow(
        /permiso/i,
      )
    })
  })

  it('rechaza un cliente de otro negocio', async () => {
    await withTransaction(async (client) => {
      await setRole(client, 'authenticated', USER_DUENO)
      await expect(client.query('select delete_customer($1)', [CUSTOMER_FERNANDA])).rejects.toThrow(
        /no perteneces/i,
      )
    })
  })

  it('rechaza un cliente que ya estaba eliminado', async () => {
    // Evita que un doble clic en "Eliminar" pise el deleted_at original.
    await withTransaction(async (client) => {
      await setRole(client, 'authenticated', USER_DUENO)
      await client.query('select delete_customer($1)', [CUSTOMER_SOFIA])
      await expect(client.query('select delete_customer($1)', [CUSTOMER_SOFIA])).rejects.toThrow(
        /no existe/i,
      )
    })
  })

  it('el anónimo no puede ejecutarla', async () => {
    await withTransaction(async (client) => {
      await setRole(client, 'anon')
      await expect(client.query('select delete_customer($1)', [CUSTOMER_SOFIA])).rejects.toThrow(
        /permission denied/i,
      )
    })
  })
})
