// create_customer_with_pet() con especie y raza del catálogo y edad estimada (fase 27,
// PLAN.md D30; migración 20261020120000_species_breeds_catalog.sql). Complementa a
// create-customer-with-pet-rpc.spec.ts, que cubre las reglas anteriores del alta.
import type { PoolClient } from 'pg'
import { afterAll, describe, expect, it } from 'vitest'

import { closePool, setRole, withTransaction } from './helpers'
import { TENANT_HUELLITAS, TENANT_PATITAS, USER_DUENO } from './fixtures'

afterAll(closePool)

async function catalogId(
  client: PoolClient,
  tenant: string,
  table: string,
  name: string,
) {
  const { rows } = await client.query(
    `select id from ${table} where tenant_id = $1 and name = $2 and deleted_at is null`,
    [tenant, name],
  )
  return rows[0].id as string
}

async function attempt(
  client: PoolClient,
  speciesId: string | null,
  breedId: string | null,
) {
  await client.query('savepoint rpc')
  try {
    const { rows } = await client.query(
      `select create_customer_with_pet(
         p_tenant_id => $1, p_first_name => 'Ana', p_last_name => 'Catálogo',
         p_pet_name => 'Xolo', p_pet_species => 'dog',
         p_pet_species_id => $2, p_pet_breed_id => $3,
         p_pet_birth_date => '2023-10-14', p_pet_birth_date_is_estimated => true
       ) as r`,
      [TENANT_PATITAS, speciesId, breedId],
    )
    await client.query('release savepoint rpc')
    return { ok: true as const, pet: rows[0].r.pet as Record<string, unknown> }
  } catch (error) {
    await client.query('rollback to savepoint rpc')
    return { ok: false as const, message: (error as Error).message }
  }
}

describe('create_customer_with_pet: catálogo y edad estimada', () => {
  // Qué prueba: que el alta guarda especie, raza y la marca de fecha estimada juntas.
  // Qué se rompería: la pantalla guardaría la mascota sin su raza del catálogo y habría que
  // corregirla después, o la fecha propuesta pasaría por dato real.
  it('guarda especie, raza y la fecha estimada', async () => {
    await withTransaction(async (client) => {
      await setRole(client, 'authenticated', USER_DUENO)
      const perro = await catalogId(client, TENANT_PATITAS, 'species', 'Perro')
      const breed = await catalogId(client, TENANT_PATITAS, 'breeds', 'Xoloitzcuintle')
      const result = await attempt(client, perro, breed)
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.pet.species_id).toBe(perro)
        expect(result.pet.breed_id).toBe(breed)
        expect(result.pet.birth_date_is_estimated).toBe(true)
      }
    })
  })

  // Qué prueba: que una especie de OTRO negocio se rechaza con mensaje y no deja nada guardado.
  // Qué se rompería: una mascota apuntaría a un catálogo ajeno (fuga entre negocios).
  it('rechaza una especie de otro negocio', async () => {
    await withTransaction(async (client) => {
      await setRole(client, 'authenticated', USER_DUENO)
      const ajena = await catalogId(client, TENANT_HUELLITAS, 'species', 'Perro').catch(
        () => null,
      )
      // El dueño de Patitas no ve el catálogo de Huellitas, así que se busca como superusuario.
      await client.query('reset role')
      const other = await catalogId(client, TENANT_HUELLITAS, 'species', 'Perro')
      await setRole(client, 'authenticated', USER_DUENO)
      const result = await attempt(client, other, null)
      expect(ajena).toBeNull()
      expect(result.ok).toBe(false)
    })
  })

  // Qué prueba: una raza que no es de la especie elegida se rechaza con el mensaje de la
  // función (no con un error de llave foránea).
  it('rechaza una raza que no corresponde a la especie', async () => {
    await withTransaction(async (client) => {
      await setRole(client, 'authenticated', USER_DUENO)
      const gato = await catalogId(client, TENANT_PATITAS, 'species', 'Gato')
      const breed = await catalogId(client, TENANT_PATITAS, 'breeds', 'Xoloitzcuintle')
      const result = await attempt(client, gato, breed)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.message).toMatch(/no corresponde a la especie/i)
    })
  })
})
