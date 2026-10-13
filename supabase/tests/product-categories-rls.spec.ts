// RLS de product_categories y products.category_id (fase 13, extensión 13G): aislamiento
// entre negocios, permiso 'inventory' por rol, nombre único, ícono válido y que un producto
// no pueda apuntar a la categoría de otro negocio. Mismo patrón que products-rls.spec.ts.
import { afterAll, describe, expect, it } from 'vitest'

import { asAnon, asUser, closePool, setRole, withTransaction } from './helpers'
import {
  CATEGORY_ALIMENTO,
  PRODUCT_ALIMENTO,
  PRODUCT_HUELLITAS,
  TENANT_HUELLITAS,
  TENANT_PATITAS,
  USER_DUENO,
  USER_GROOMER,
  USER_RECEPCION,
  USER_VET,
} from './fixtures'

afterAll(closePool)

const INSERT_SQL = `insert into product_categories (tenant_id, name, icon)
  values ($1, 'Categoría de prueba', 'mdi-bone') returning id`

describe('product_categories: aislamiento entre negocios', () => {
  it('el visitante anónimo no ve ninguna categoría', async () => {
    // §7.3.3: anon no lee nada de negocio. Si alguien abriera una política por error,
    // cualquiera con la llave pública vería cómo organiza su catálogo cada negocio.
    await asAnon(async (client) => {
      const { rows } = await client.query('select id from product_categories')
      expect(rows).toHaveLength(0)
    })
  })

  it('el dueño de OTRO negocio no ve ni edita las categorías de Patitas', async () => {
    // Un UPDATE que RLS no deja pasar no falla: afecta 0 filas. Si fallara, un negocio
    // podría renombrar o desactivar las categorías de otro.
    await withTransaction(async (client) => {
      await setRole(client, 'service_role')
      await client.query(
        'update memberships set tenant_id = $1, role = $2 where user_id = $3',
        [TENANT_HUELLITAS, 'owner', USER_GROOMER],
      )
      await setRole(client, 'authenticated', USER_GROOMER)

      const seen = await client.query('select id from product_categories')
      expect(seen.rows).toHaveLength(0)

      const updated = await client.query(
        "update product_categories set name = 'hackeada' where id = $1",
        [CATEGORY_ALIMENTO],
      )
      expect(updated.rowCount).toBe(0)

      await expect(client.query(INSERT_SQL, [TENANT_PATITAS])).rejects.toThrow(
        /row-level security/,
      )
    })
  })

  it('un producto no puede apuntar a la categoría de OTRO negocio', async () => {
    // La llave foránea compuesta (tenant_id, category_id). Sin ella, bastaría conocer un id
    // para colgar un producto propio en la categoría ajena y verlo aparecer en su tienda.
    await withTransaction(async (client) => {
      await setRole(client, 'service_role')
      await expect(
        client.query('update products set category_id = $1 where id = $2', [
          CATEGORY_ALIMENTO,
          PRODUCT_HUELLITAS,
        ]),
      ).rejects.toThrow(/products_category_fkey/)
    })
  })
})

describe('product_categories: permiso inventory por rol', () => {
  it('control: el dueño ve las cuatro categorías de Patitas y puede crear otra', async () => {
    await asUser(USER_DUENO, async (client) => {
      const { rows } = await client.query('select id from product_categories')
      expect(rows).toHaveLength(4)

      const created = await client.query(INSERT_SQL, [TENANT_PATITAS])
      expect(created.rows).toHaveLength(1)
    })
  })

  it('recepción puede crear y editar categorías', async () => {
    // Recepción da de alta lo que llega al mostrador; si perdiera el permiso, el dueño
    // tendría que clasificar cada producto nuevo.
    await asUser(USER_RECEPCION, async (client) => {
      const created = await client.query(INSERT_SQL, [TENANT_PATITAS])
      const updated = await client.query(
        "update product_categories set name = 'Renombrada' where id = $1",
        [created.rows[0].id],
      )
      expect(updated.rowCount).toBe(1)
    })
  })

  it('el veterinario ve las categorías pero no puede crearlas ni editarlas', async () => {
    // Misma diferencia can_view / can_edit que en products.
    await asUser(USER_VET, async (client) => {
      const { rows } = await client.query('select id from product_categories')
      expect(rows).toHaveLength(4)
      const updated = await client.query(
        "update product_categories set name = 'cambiada' where id = $1",
        [CATEGORY_ALIMENTO],
      )
      expect(updated.rowCount).toBe(0)
    })
    await asUser(USER_VET, async (client) => {
      await expect(client.query(INSERT_SQL, [TENANT_PATITAS])).rejects.toThrow(
        /row-level security/,
      )
    })
  })

  it('el groomer no ve ninguna categoría', async () => {
    // La regla la decide la base, no un v-if: sin permiso 'inventory' ve cero filas.
    await asUser(USER_GROOMER, async (client) => {
      const { rows } = await client.query('select id from product_categories')
      expect(rows).toHaveLength(0)
    })
  })
})

describe('product_categories: reglas de la tabla', () => {
  it('no admite dos categorías con el mismo nombre en un negocio (sin importar mayúsculas)', async () => {
    // Dos "Alimento" en la fila de categorías confundirían a quien cobra y partirían el
    // catálogo en dos sin que se note.
    await asUser(USER_DUENO, async (client) => {
      await expect(
        client.query(
          `insert into product_categories (tenant_id, name, icon)
           values ($1, '  ALIMENTO ', 'mdi-bone')`,
          [TENANT_PATITAS],
        ),
      ).rejects.toThrow(/product_categories_tenant_name_key/)
    })
  })

  it('un nombre ya usado por una categoría oculta se puede reutilizar', async () => {
    // El índice único es parcial (deleted_at is null): si no, una categoría oculta por
    // error dejaría su nombre inutilizable para siempre.
    await asUser(USER_DUENO, async (client) => {
      await client.query(
        'update product_categories set deleted_at = now() where id = $1',
        [CATEGORY_ALIMENTO],
      )
      const created = await client.query(
        `insert into product_categories (tenant_id, name, icon)
         values ($1, 'Alimento', 'mdi-bone') returning id`,
        [TENANT_PATITAS],
      )
      expect(created.rows).toHaveLength(1)
    })
  })

  it('rechaza un ícono que no tiene forma de ícono de Material Design', async () => {
    // Un valor como 'javascript:x' o vacío dejaría una tarjeta sin ícono, o algo peor.
    await asUser(USER_DUENO, async (client) => {
      await expect(
        client.query(
          `insert into product_categories (tenant_id, name, icon)
           values ($1, 'Rara', 'hueso')`,
          [TENANT_PATITAS],
        ),
      ).rejects.toThrow(/product_categories_icon_check/)
    })
  })

  it('desactivar una categoría no toca a sus productos', async () => {
    // Decisión del usuario: sus productos pasan a "Sin categoría" en la pantalla, pero la
    // base no les cambia nada (conservan category_id y se recupera al reactivarla).
    await asUser(USER_DUENO, async (client) => {
      await client.query(
        'update product_categories set is_active = false where id = $1',
        [CATEGORY_ALIMENTO],
      )
      const { rows } = await client.query(
        'select category_id from products where id = $1',
        [PRODUCT_ALIMENTO],
      )
      expect(rows[0].category_id).toBe(CATEGORY_ALIMENTO)
    })
  })

  it('nadie puede borrar físicamente una categoría, ni el dueño', async () => {
    // §7.3.2: sin política de DELETE, Postgres afecta 0 filas.
    await asUser(USER_DUENO, async (client) => {
      const { rowCount } = await client.query(
        'delete from product_categories where id = $1',
        [CATEGORY_ALIMENTO],
      )
      expect(rowCount).toBe(0)
    })
  })
})
