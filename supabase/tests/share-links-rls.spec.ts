// RLS de share_links (tarea 7.1). CLAUDE.md §6.1 no restringe generar o
// revocar un link a un rol en particular — cualquier miembro activo del
// tenant puede hacerlo, a diferencia de servicios/vacunas (catálogo,
// solo owner) o del expediente clínico (solo owner/vet). El `anon` no
// tiene ninguna política aquí: la vista pública nunca consulta esta
// tabla directo, pasa por la Edge Function (tarea 7.4).
import { afterAll, describe, expect, it } from 'vitest'
import type { PoolClient } from 'pg'

import { asAnon, closePool, setRole, withTransaction } from './helpers'
import { PET_ROCKY, TENANT_HUELLITAS, TENANT_PATITAS, USER_GROOMER } from './fixtures'

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

describe('share_links: cualquier miembro activo administra los de su tenant', () => {
  it('un groomer puede generar un link para una mascota de su tenant', async () => {
    await withTransaction(async (client) => {
      await setRole(client, 'authenticated', USER_GROOMER)
      const { rows } = await client.query(
        `insert into share_links (tenant_id, scope, pet_id, token_hash, token_prefix, expires_at, created_by)
         values ($1, 'pet', $2, 'otro-hash-de-prueba', 'zZ9y', now() + interval '30 days', $3)
         returning id`,
        [TENANT_PATITAS, PET_ROCKY, USER_GROOMER],
      )
      expect(rows).toHaveLength(1)
    })
  })

  it('un groomer puede revocar (UPDATE de revoked_at) un link de su tenant', async () => {
    await withTransaction(async (client) => {
      const linkId = await seedShareLink(client)

      await setRole(client, 'authenticated', USER_GROOMER)
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
