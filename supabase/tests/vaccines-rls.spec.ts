// RLS de vaccines (catálogo) y vaccinations (expediente) — completa la
// tarea 4.4. vaccines sigue el patrón de "catálogo" (como services,
// fase 3): solo owner escribe, cualquier miembro activo lee. vaccinations
// es más abierta en lectura que medical_records a propósito (ver el
// comentario en la migración vaccines.sql).
import { afterAll, describe, expect, it } from 'vitest'

import { asUser, closePool, setRole, withTransaction } from './helpers'
import {
  PET_ROCKY,
  TENANT_HUELLITAS,
  TENANT_PATITAS,
  USER_DUENO,
  USER_GROOMER,
  USER_RECEPCION,
  USER_VET,
  VACCINE_RABIA,
} from './fixtures'

afterAll(closePool)

describe('vaccines: catálogo', () => {
  it('cualquier miembro activo lo lee, incluido groomer', async () => {
    const { rows } = await asUser(USER_GROOMER, (c) =>
      c.query('select id from vaccines where id = $1', [VACCINE_RABIA]),
    )
    expect(rows).toHaveLength(1)
  })

  it('un groomer no puede dar de alta una vacuna nueva (config del negocio, solo owner)', async () => {
    await withTransaction(async (client) => {
      await setRole(client, 'authenticated', USER_GROOMER)
      await expect(
        client.query(
          "insert into vaccines (tenant_id, name) values ($1, 'No debería crearse')",
          [TENANT_PATITAS],
        ),
      ).rejects.toThrow(/row-level security/i)
    })
  })

  it('un miembro de otro tenant no ve el catálogo de Patitas Felices', async () => {
    await withTransaction(async (client) => {
      await setRole(client, 'service_role')
      await client.query('update memberships set tenant_id = $1 where user_id = $2', [
        TENANT_HUELLITAS,
        USER_GROOMER,
      ])

      await setRole(client, 'authenticated', USER_GROOMER)
      const { rows } = await client.query('select id from vaccines where id = $1', [
        VACCINE_RABIA,
      ])
      expect(rows).toHaveLength(0)
    })
  })
})

describe('vaccinations: expediente, pero de lectura más abierta que medical_records', () => {
  async function seedVaccination(
    client: Parameters<typeof setRole>[0],
  ): Promise<string> {
    await setRole(client, 'service_role')
    const { rows } = await client.query(
      `insert into vaccinations (tenant_id, pet_id, vaccine_id, applied_by_user_id, next_due_date)
       values ($1, $2, $3, $4, current_date + interval '365 days')
       returning id`,
      [TENANT_PATITAS, PET_ROCKY, VACCINE_RABIA, USER_VET],
    )
    return rows[0].id
  }

  it('receptionist Y groomer pueden leerla (a diferencia de medical_records)', async () => {
    await withTransaction(async (client) => {
      const id = await seedVaccination(client)

      await setRole(client, 'authenticated', USER_RECEPCION)
      const { rows: asRecepcion } = await client.query(
        'select id from vaccinations where id = $1',
        [id],
      )
      expect(asRecepcion).toHaveLength(1)

      await setRole(client, 'authenticated', USER_GROOMER)
      const { rows: asGroomer } = await client.query(
        'select id from vaccinations where id = $1',
        [id],
      )
      expect(asGroomer).toHaveLength(1)
    })
  })

  it('un miembro de otro tenant no la ve', async () => {
    await withTransaction(async (client) => {
      const id = await seedVaccination(client)

      await setRole(client, 'service_role')
      await client.query('update memberships set tenant_id = $1 where user_id = $2', [
        TENANT_HUELLITAS,
        USER_GROOMER,
      ])

      await setRole(client, 'authenticated', USER_GROOMER)
      const { rows } = await client.query('select id from vaccinations where id = $1', [id])
      expect(rows).toHaveLength(0)
    })
  })

  it('un groomer no puede aplicar (insertar) una vacuna — es acto médico', async () => {
    await withTransaction(async (client) => {
      await setRole(client, 'authenticated', USER_GROOMER)
      await expect(
        client.query(
          `insert into vaccinations (tenant_id, pet_id, vaccine_id)
           values ($1, $2, $3)`,
          [TENANT_PATITAS, PET_ROCKY, VACCINE_RABIA],
        ),
      ).rejects.toThrow(/row-level security/i)
    })
  })

  it('el vet SÍ puede aplicar una vacuna, sin necesitar una cita ligada', async () => {
    await withTransaction(async (client) => {
      await setRole(client, 'authenticated', USER_VET)
      const { rows } = await client.query(
        `insert into vaccinations (tenant_id, pet_id, vaccine_id, applied_by_user_id)
         values ($1, $2, $3, $4) returning id`,
        [TENANT_PATITAS, PET_ROCKY, VACCINE_RABIA, USER_VET],
      )
      expect(rows).toHaveLength(1)
    })
  })

  it('control: el dueño ve cualquier vacunación de su tenant', async () => {
    await withTransaction(async (client) => {
      const id = await seedVaccination(client)

      await setRole(client, 'authenticated', USER_DUENO)
      const { rows } = await client.query('select id from vaccinations where id = $1', [id])
      expect(rows).toHaveLength(1)
    })
  })
})
