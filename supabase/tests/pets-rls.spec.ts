// Aislamiento entre tenants para pets y pet_weights (tarea 2.13). Mismo
// patrón que customers-rls.spec.ts — ver ese archivo para el porqué del
// truco de reasignar la membresía del groomer.
import { afterAll, describe, expect, it } from 'vitest'

import { asUser, closePool, setRole, withTransaction } from './helpers'
import { PET_ROCKY, TENANT_HUELLITAS, TENANT_PATITAS, USER_DUENO, USER_GROOMER } from './fixtures'

afterAll(closePool)

describe('Aislamiento entre tenants: pets', () => {
  it('un miembro de otro tenant no ve una mascota del tenant A por id', async () => {
    await withTransaction(async (client) => {
      await setRole(client, 'service_role')
      await client.query('update memberships set tenant_id = $1 where user_id = $2', [
        TENANT_HUELLITAS,
        USER_GROOMER,
      ])

      await setRole(client, 'authenticated', USER_GROOMER)
      const { rows } = await client.query('select id from pets where id = $1', [PET_ROCKY])

      expect(rows).toHaveLength(0)
    })
  })

  it('un miembro de otro tenant no puede actualizar (ni borrar suave) una mascota del tenant A', async () => {
    await withTransaction(async (client) => {
      await setRole(client, 'service_role')
      await client.query('update memberships set tenant_id = $1, role = $2 where user_id = $3', [
        TENANT_HUELLITAS,
        'owner',
        USER_GROOMER,
      ])

      await setRole(client, 'authenticated', USER_GROOMER)
      const { rowCount } = await client.query(
        'update pets set deleted_at = now() where id = $1',
        [PET_ROCKY],
      )

      expect(rowCount).toBe(0)
    })
  })

  it('control: el dueño real de Patitas Felices sí ve a Rocky', async () => {
    const { rows } = await asUser(USER_DUENO, (c) =>
      c.query('select id, name from pets where id = $1', [PET_ROCKY]),
    )

    expect(rows).toHaveLength(1)
    expect(rows[0].name).toBe('Rocky')
  })
})

describe('Aislamiento entre tenants: pet_weights', () => {
  it('un miembro de otro tenant no ve el historial de peso del tenant A', async () => {
    await withTransaction(async (client) => {
      await setRole(client, 'service_role')
      await client.query('update memberships set tenant_id = $1 where user_id = $2', [
        TENANT_HUELLITAS,
        USER_GROOMER,
      ])

      await setRole(client, 'authenticated', USER_GROOMER)
      const { rows } = await client.query(
        'select id from pet_weights where tenant_id = $1',
        [TENANT_PATITAS],
      )

      expect(rows).toHaveLength(0)
    })
  })

  it('cualquier rol activo del tenant correcto puede registrar un peso (no solo owner/receptionist)', async () => {
    // A diferencia de pets/customers, pet_weights permite INSERT a
    // cualquier rol (CLAUDE.md: pesar a la mascota es parte de atenderla,
    // no una tarea exclusiva de recepción) — este caso confirma que el
    // groomer, en SU tenant real, sí puede.
    await withTransaction(async (client) => {
      await setRole(client, 'authenticated', USER_GROOMER)
      const { rows } = await client.query(
        'insert into pet_weights (tenant_id, pet_id, weight_grams) values ($1, $2, $3) returning id',
        [TENANT_PATITAS, PET_ROCKY, 29000],
      )

      expect(rows).toHaveLength(1)
    })
  })
})
