// create_customer_with_pet(): alta de cliente y mascota en una sola transacción
// (Correcciones 1, tarea C1.4, PLAN.md D26 punto 4; migración
// 20261014130000_create_customer_with_pet.sql).
//
// Se llama la función por SQL, tal cual la usa la app (RPC), dentro de una
// transacción de prueba que se revierte sola (helpers.ts). Con "savepoint" se
// puede comprobar DESPUÉS de un fallo que no quedó nada guardado.
import type { PoolClient } from 'pg'
import { afterAll, describe, expect, it } from 'vitest'

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

interface Args {
  tenantId?: string
  firstName?: string
  lastName?: string
  email?: string | null
  petName?: string | null
  species?: string | null
  sex?: string | null
}

type Outcome =
  | { ok: true; customer: Record<string, unknown>; pet: Record<string, unknown> }
  | { ok: false; message: string; code: string | null; hint: string | null }

async function call(client: PoolClient, a: Args = {}): Promise<Outcome> {
  await client.query('savepoint rpc')
  try {
    const { rows } = await client.query(
      `select create_customer_with_pet(
         p_tenant_id => $1, p_first_name => $2, p_last_name => $3,
         p_phone => '5551112222', p_email => $4,
         p_pet_name => $5, p_pet_species => $6::pet_species, p_pet_breed => 'Criollo',
         p_pet_sex => $7::pet_sex, p_pet_is_sterilized => true
       ) as r`,
      [
        a.tenantId ?? TENANT_PATITAS,
        a.firstName ?? 'Lucía',
        a.lastName ?? 'Alta',
        a.email === undefined ? 'lucia.alta@example.mx' : a.email,
        a.petName === undefined ? 'Canela' : a.petName,
        a.species === undefined ? 'dog' : a.species,
        a.sex === undefined ? 'female' : a.sex,
      ],
    )
    await client.query('release savepoint rpc')
    return { ok: true, customer: rows[0].r.customer, pet: rows[0].r.pet }
  } catch (error) {
    await client.query('rollback to savepoint rpc')
    const e = error as { message: string; code?: string; hint?: string }
    return { ok: false, message: e.message, code: e.code ?? null, hint: e.hint ?? null }
  }
}

async function count(client: PoolClient, sql: string, params: unknown[]): Promise<number> {
  const { rows } = await client.query(sql, params)
  return rows[0].n
}

const CUSTOMERS_BY_NAME = `select count(*)::int as n from customers where tenant_id = $1 and first_name = $2`
const PETS_BY_NAME = `select count(*)::int as n from pets where tenant_id = $1 and name = $2`

describe('create_customer_with_pet()', () => {
  it('crea al cliente y a su mascota, ligados, y devuelve ambos registros', async () => {
    // Caso feliz: el cliente nuevo tiene su mascota y la mascota apunta a él.
    // Si el customer_id no se ligara bien, la mascota quedaría huérfana.
    await withTransaction(async (client) => {
      await setRole(client, 'authenticated', USER_RECEPCION)
      const r = await call(client)
      expect(r.ok).toBe(true)
      if (!r.ok) return
      expect(r.customer.first_name).toBe('Lucía')
      expect(r.customer.tenant_id).toBe(TENANT_PATITAS)
      expect(r.pet.name).toBe('Canela')
      expect(r.pet.customer_id).toBe(r.customer.id)
      expect(r.pet.species).toBe('dog')
      expect(r.pet.is_sterilized).toBe(true)
    })
  })

  it('el dueño también puede', async () => {
    await withTransaction(async (client) => {
      await setRole(client, 'authenticated', USER_DUENO)
      expect((await call(client)).ok).toBe(true)
    })
  })

  it('una mascota sin nombre o sin especie no deja al cliente guardado', async () => {
    // El objetivo de la función: nunca un cliente "a medias". Se prueba que
    // tras el rechazo no existe el cliente con ese nombre.
    await withTransaction(async (client) => {
      await setRole(client, 'authenticated', USER_RECEPCION)

      const sinNombre = await call(client, { petName: '   ' })
      expect(sinNombre.ok).toBe(false)
      if (!sinNombre.ok) expect(sinNombre.message).toMatch(/nombre de la mascota/i)

      const sinEspecie = await call(client, { species: null })
      expect(sinEspecie.ok).toBe(false)
      if (!sinEspecie.ok) expect(sinEspecie.message).toMatch(/especie/i)

      expect(await count(client, CUSTOMERS_BY_NAME, [TENANT_PATITAS, 'Lucía'])).toBe(0)
    })
  })

  it('si la mascota falla DESPUÉS de crear al cliente, el cliente tampoco queda (atomicidad)', async () => {
    // Las validaciones de arriba se hacen antes del primer INSERT, así que no
    // prueban la atomicidad. Aquí se fuerza un fallo real del INSERT de la
    // mascota con un trigger temporal (solo vive en esta transacción) que
    // rechaza cualquier mascota. Si el cliente quedara guardado, la función
    // dejaría datos a medias, que es justo lo que se quiere evitar.
    await withTransaction(async (client) => {
      await client.query(`
        create function pg_temp.reject_pet() returns trigger language plpgsql as $$
        begin raise exception 'mascota rechazada a propósito'; end; $$`)
      await client.query(`
        create trigger zz_reject_pet before insert on pets
        for each row execute function pg_temp.reject_pet()`)

      await setRole(client, 'authenticated', USER_RECEPCION)
      const r = await call(client)
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.message).toMatch(/a propósito/)

      await setRole(client, 'service_role')
      expect(await count(client, CUSTOMERS_BY_NAME, [TENANT_PATITAS, 'Lucía'])).toBe(0)
    })
  })

  it('un correo repetido hace fallar TODA el alta (C1.3): no queda cliente ni mascota', async () => {
    // El trigger de correo único aplica solo porque la función inserta en
    // customers. Se verifica que la excepción deshace también la mascota.
    await withTransaction(async (client) => {
      await setRole(client, 'authenticated', USER_RECEPCION)
      expect((await call(client, { email: 'repetido@example.mx', petName: 'Primera' })).ok).toBe(true)

      const r = await call(client, {
        firstName: 'Otra',
        email: 'REPETIDO@example.mx',
        petName: 'Segunda',
      })
      expect(r.ok).toBe(false)
      if (!r.ok) {
        expect(r.code).toBe('23505')
        expect(r.hint).toBe('customer_email_taken')
      }
      expect(await count(client, CUSTOMERS_BY_NAME, [TENANT_PATITAS, 'Otra'])).toBe(0)
      expect(await count(client, PETS_BY_NAME, [TENANT_PATITAS, 'Segunda'])).toBe(0)
    })
  })

  it('un groomer y un vet no pueden dar de alta clientes', async () => {
    // Igual que las políticas de INSERT de customers (§6.1): atender no es dar
    // de alta. Como la función es SECURITY DEFINER salta RLS, así que esta
    // revalidación interna es lo único que lo impide.
    await withTransaction(async (client) => {
      for (const user of [USER_GROOMER, USER_VET]) {
        await setRole(client, 'authenticated', user)
        const r = await call(client)
        expect(r.ok).toBe(false)
        if (!r.ok) expect(r.message).toMatch(/No tienes permiso/i)
      }
      await setRole(client, 'service_role')
      expect(await count(client, CUSTOMERS_BY_NAME, [TENANT_PATITAS, 'Lucía'])).toBe(0)
    })
  })

  it('el dueño de otro negocio no puede dar de alta clientes en este', async () => {
    // Aislamiento multi-tenant: pasar el tenant_id ajeno no debe funcionar,
    // aunque la función corra con privilegios altos.
    await withTransaction(async (client) => {
      await setRole(client, 'authenticated', USER_DUENO)
      const r = await call(client, { tenantId: TENANT_HUELLITAS })
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.message).toMatch(/No perteneces/i)
    })
  })

  it('un visitante sin sesión no puede ejecutarla', async () => {
    // Regla dura §7.3.3: anon no ejecuta nada.
    await withTransaction(async (client) => {
      await setRole(client, 'anon')
      const r = await call(client)
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.message).toMatch(/permission denied/i)
    })
  })

  it('un negocio en solo lectura la rechaza (enforce_tenant_writable)', async () => {
    // La función salta RLS pero NO los triggers: el bloqueo por estado del
    // negocio (§6.8) debe seguir aplicando.
    await withTransaction(async (client) => {
      await client.query(
        `update tenant_platform_info set status = 'suspended', public_reason = 'Falta de pago'
          where tenant_id = $1`,
        [TENANT_PATITAS],
      )
      await setRole(client, 'authenticated', USER_RECEPCION)
      const r = await call(client)
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.message).toMatch(/solo lectura/i)
    })
  })
})
