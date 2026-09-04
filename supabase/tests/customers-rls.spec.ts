// Aislamiento entre tenants para customers (tarea 2.11) — mismo patrón
// que supabase/tests/tenancy-isolation.spec.ts: pg + simulación de rol,
// dentro de una transacción que se revierte sola. Huellitas Spa no tiene
// personal propio en la semilla (supabase/seed.sql lo deja así a
// propósito, solo para esto), así que se reasigna temporalmente la
// membresía del groomer a Huellitas — el mismo truco que ya usa
// tenancy-isolation.spec.ts.
import { afterAll, describe, expect, it } from 'vitest'

import { asUser, closePool, setRole, withTransaction } from './helpers'
import { CUSTOMER_SOFIA, TENANT_HUELLITAS, USER_DUENO, USER_GROOMER } from './fixtures'

afterAll(closePool)

describe('Aislamiento entre tenants: customers', () => {
  it('un miembro de otro tenant no ve un cliente del tenant A ni pidiéndolo por id', async () => {
    // Sofía (CUSTOMER_SOFIA) es de Patitas Felices. Si el aislamiento
    // fallara aquí, cualquier negocio en la plataforma podría leer los
    // datos de contacto (y, si facturara, el RFC) de los clientes de
    // otro negocio.
    await withTransaction(async (client) => {
      await setRole(client, 'service_role')
      await client.query('update memberships set tenant_id = $1 where user_id = $2', [
        TENANT_HUELLITAS,
        USER_GROOMER,
      ])

      await setRole(client, 'authenticated', USER_GROOMER)
      const { rows } = await client.query('select id from customers where id = $1', [
        CUSTOMER_SOFIA,
      ])

      expect(rows).toHaveLength(0)
    })
  })

  it('un miembro de otro tenant no puede actualizar un cliente del tenant A por id', async () => {
    // Se sube al usuario a "owner" de su tenant reasignado a propósito:
    // así, si el UPDATE fallara, queda claro que es por AISLAMIENTO de
    // tenant (lo que se prueba aquí), no porque le faltara el rol
    // correcto — ese caso ya lo cubre customers_insert/update por
    // separado, no es lo que este test necesita demostrar.
    await withTransaction(async (client) => {
      await setRole(client, 'service_role')
      await client.query('update memberships set tenant_id = $1, role = $2 where user_id = $3', [
        TENANT_HUELLITAS,
        'owner',
        USER_GROOMER,
      ])

      await setRole(client, 'authenticated', USER_GROOMER)
      const { rowCount } = await client.query(
        "update customers set notes = 'modificado por otro tenant' where id = $1",
        [CUSTOMER_SOFIA],
      )

      // 0 filas afectadas, no un error — RLS hace invisible la fila para
      // el UPDATE, como si no existiera (mismo criterio que el SELECT).
      expect(rowCount).toBe(0)
    })
  })

  it('control: el dueño real de Patitas Felices SÍ ve y puede editar a Sofía', async () => {
    // Sin este caso, los dos de arriba podrían estar "pasando" solo
    // porque la consulta está mal escrita (p. ej. un id equivocado), no
    // porque RLS de verdad esté bloqueando. Confirma que el mecanismo
    // funciona en ambos sentidos.
    const { rows } = await asUser(USER_DUENO, (c) =>
      c.query('select id, first_name from customers where id = $1', [CUSTOMER_SOFIA]),
    )

    expect(rows).toHaveLength(1)
    expect(rows[0].first_name).toBe('Sofía')
  })
})
