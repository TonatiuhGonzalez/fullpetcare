// RLS de share_links (tarea 7.1, endurecido en la migración
// role_permission_hardening.sql tras el UAT). La fase 7 lo dejó abierto
// a cualquier rol activo a propósito; el UAT pidió que generar y revocar
// el link público quede reservado a owner/receptionist (mismo criterio
// que agendar citas o editar clientes: es una tarea de recepción, no de
// quien atiende) — groomer y vet SIGUEN pudiendo VER qué links existen
// (SELECT no cambió), solo no pueden crearlos ni revocarlos. El `anon`
// no tiene ninguna política aquí: la vista pública nunca consulta esta
// tabla directo, pasa por la Edge Function (tarea 7.4).
import { afterAll, describe, expect, it } from 'vitest'
import type { PoolClient } from 'pg'

import { asAnon, closePool, setRole, withTransaction } from './helpers'
import {
  PET_ROCKY,
  TENANT_HUELLITAS,
  TENANT_PATITAS,
  USER_DUENO,
  USER_GROOMER,
  USER_RECEPCION,
} from './fixtures'

afterAll(closePool)

async function seedShareLink(client: PoolClient): Promise<string> {
  await setRole(client, 'service_role')
  const { rows } = await client.query(
    `insert into share_links (tenant_id, scope, pet_id, token_hash, token_prefix, expires_at, created_by)
     values ($1, 'pet', $2, 'hash-de-prueba', 'aB1c', now() + interval '30 days', $3)
     returning id`,
    [TENANT_PATITAS, PET_ROCKY, USER_GROOMER],
  )
  return rows[0].id
}

describe('share_links: generar y revocar quedan reservados a owner/receptionist', () => {
  it('un groomer NO puede generar un link (solo owner/receptionist, tras el UAT)', async () => {
    await withTransaction(async (client) => {
      await setRole(client, 'authenticated', USER_GROOMER)
      await expect(
        client.query(
          `insert into share_links (tenant_id, scope, pet_id, token_hash, token_prefix, expires_at, created_by)
           values ($1, 'pet', $2, 'otro-hash-de-prueba', 'zZ9y', now() + interval '30 days', $3)`,
          [TENANT_PATITAS, PET_ROCKY, USER_GROOMER],
        ),
      ).rejects.toThrow(/row-level security/i)
    })
  })

  it('control: recepción SÍ puede generar un link', async () => {
    await withTransaction(async (client) => {
      await setRole(client, 'authenticated', USER_RECEPCION)
      const { rows } = await client.query(
        `insert into share_links (tenant_id, scope, pet_id, token_hash, token_prefix, expires_at, created_by)
         values ($1, 'pet', $2, 'otro-hash-de-prueba', 'zZ9y', now() + interval '30 days', $3)
         returning id`,
        [TENANT_PATITAS, PET_ROCKY, USER_RECEPCION],
      )
      expect(rows).toHaveLength(1)
    })
  })

  it('un groomer NO puede revocar (UPDATE de revoked_at) un link', async () => {
    await withTransaction(async (client) => {
      const linkId = await seedShareLink(client)

      await setRole(client, 'authenticated', USER_GROOMER)
      const { rowCount } = await client.query(
        'update share_links set revoked_at = now() where id = $1',
        [linkId],
      )
      // Sin "rejects.toThrow": un UPDATE que no calza con ninguna fila
      // visible/editable bajo RLS no lanza error, simplemente afecta 0
      // filas — mismo patrón que appointments_update en appointments-rls.spec.ts.
      expect(rowCount).toBe(0)
    })
  })

  it('control: el dueño SÍ puede revocar un link', async () => {
    await withTransaction(async (client) => {
      const linkId = await seedShareLink(client)

      await setRole(client, 'authenticated', USER_DUENO)
      const { rowCount } = await client.query(
        'update share_links set revoked_at = now() where id = $1',
        [linkId],
      )
      expect(rowCount).toBe(1)
    })
  })

  it('un miembro de OTRO tenant no ve el link (aislamiento entre tenants)', async () => {
    await withTransaction(async (client) => {
      const linkId = await seedShareLink(client)

      await setRole(client, 'service_role')
      await client.query('update memberships set tenant_id = $1 where user_id = $2', [
        TENANT_HUELLITAS,
        USER_GROOMER,
      ])

      await setRole(client, 'authenticated', USER_GROOMER)
      const { rows } = await client.query('select id from share_links where id = $1', [linkId])
      expect(rows).toHaveLength(0)
    })
  })

  it('control: el mismo groomer, sin reasignar de tenant, sí ve el link', async () => {
    await withTransaction(async (client) => {
      const linkId = await seedShareLink(client)

      await setRole(client, 'authenticated', USER_GROOMER)
      const { rows } = await client.query('select id from share_links where id = $1', [linkId])
      expect(rows).toHaveLength(1)
    })
  })
})

describe('share_links: el rol anon no tiene ningún acceso', () => {
  it('anon no puede leer share_links, ni con el id exacto', async () => {
    const linkId = await withTransaction(async (client) => seedShareLink(client))
    // seedShareLink corrió dentro de una transacción que se revirtió
    // (withTransaction siempre hace ROLLBACK) — pero eso no importa aquí:
    // el punto es que, exista o no la fila, anon jamás puede verla.
    const { rows } = await asAnon((c) =>
      c.query('select id from share_links where id = $1', [linkId]),
    )
    expect(rows).toHaveLength(0)
  })

  it('anon no puede insertar un share_link', async () => {
    const { rows } = await asAnon((c) => c.query('select 1'))
    expect(rows).toHaveLength(1) // control: la conexión anon en sí funciona

    await expect(
      asAnon((c) =>
        c.query(
          `insert into share_links (tenant_id, scope, pet_id, token_hash, token_prefix, expires_at, created_by)
           values ($1, 'pet', $2, 'hash-anon', 'aaaa', now() + interval '1 day', $3)`,
          [TENANT_PATITAS, PET_ROCKY, USER_GROOMER],
        ),
      ),
    ).rejects.toThrow(/row-level security/i)
  })
})
