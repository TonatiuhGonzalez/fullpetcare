// Aislamiento entre tenants para services (tarea 3.9). Mismo patrón que
// customers-rls.spec.ts.
import { afterAll, describe, expect, it } from 'vitest'

import { asUser, closePool, setRole, withTransaction } from './helpers'
import { SERVICE_BANO, TENANT_HUELLITAS, USER_DUENO, USER_GROOMER } from './fixtures'

afterAll(closePool)

describe('Aislamiento entre tenants: services', () => {
  it('un miembro de otro tenant no ve un servicio del catálogo del tenant A', async () => {
    await withTransaction(async (client) => {
      await setRole(client, 'service_role')
      await client.query('update memberships set tenant_id = $1 where user_id = $2', [
        TENANT_HUELLITAS,
        USER_GROOMER,
      ])

      await setRole(client, 'authenticated', USER_GROOMER)
      const { rows } = await client.query('select id from services where id = $1', [
        SERVICE_BANO,
      ])

      expect(rows).toHaveLength(0)
    })
  })

  it('un miembro de otro tenant, aunque sea owner ahí, no puede editar un servicio del tenant A', async () => {
    await withTransaction(async (client) => {
      await setRole(client, 'service_role')
      await client.query('update memberships set tenant_id = $1, role = $2 where user_id = $3', [
        TENANT_HUELLITAS,
        'owner',
        USER_GROOMER,
      ])

      await setRole(client, 'authenticated', USER_GROOMER)
      const { rowCount } = await client.query(
        "update services set name = 'hackeado' where id = $1",
        [SERVICE_BANO],
      )

      expect(rowCount).toBe(0)
    })
  })

  it('control: el dueño real de Patitas Felices sí ve el Baño en su catálogo', async () => {
    const { rows } = await asUser(USER_DUENO, (c) =>
      c.query('select id, name from services where id = $1', [SERVICE_BANO]),
    )

    expect(rows).toHaveLength(1)
    expect(rows[0].name).toBe('Baño')
  })
})
