// RLS de products (fase 11, tarea 11.4 / HMH Four #2038): aislamiento entre
// negocios, permiso 'inventory' por rol, borrado suave y reglas de la tabla.
// Mismo patrón que services-rls.spec.ts.
//
// Reglas de la fase (se siembran en role_permissions): dueño ver+editar,
// recepción ver+editar, veterinario solo ver, groomer nada.
import type { PoolClient } from 'pg'
import { afterAll, describe, expect, it } from 'vitest'

import { asAnon, asUser, closePool, setRole, withTransaction } from './helpers'
import {
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

const INSERT_SQL = `insert into products (tenant_id, name, price_cents) values ($1, 'Producto de prueba', 10000) returning id`

// Pasa a un usuario de Patitas a ser dueño de Huellitas Spa, para probar que
// alguien con TODOS los permisos en OTRO negocio no alcanza el de Patitas.
async function moveToHuellitasAsOwner(client: PoolClient, userId: string) {
  await setRole(client, 'service_role')
  await client.query('update memberships set tenant_id = $1, role = $2 where user_id = $3', [
    TENANT_HUELLITAS,
    'owner',
    userId,
  ])
  await setRole(client, 'authenticated', userId)
}

describe('products: aislamiento entre tenants', () => {
  it('el dueño de OTRO negocio no ve los productos de Patitas Felices, solo los suyos', async () => {
    // Si fallara, un negocio vería precios, costos y códigos de otro: es
    // información comercial de la competencia.
    await withTransaction(async (client) => {
      await moveToHuellitasAsOwner(client, USER_GROOMER)
      const { rows } = await client.query('select id from products')

      expect(rows.map((r) => r.id)).toEqual([PRODUCT_HUELLITAS])
    })
  })

  it('el dueño de otro negocio no puede editar un producto de Patitas', async () => {
    // Un UPDATE que RLS no deja pasar no falla: afecta 0 filas. Si fallara,
    // un negocio podría cambiar los precios de otro.
    await withTransaction(async (client) => {
      await moveToHuellitasAsOwner(client, USER_GROOMER)
      const { rowCount } = await client.query(
        "update products set name = 'hackeado' where id = $1",
        [PRODUCT_ALIMENTO],
      )

      expect(rowCount).toBe(0)
    })
  })

  it('el dueño de otro negocio no puede insertar un producto con el tenant_id de Patitas', async () => {
    // El with check de INSERT: sin él, se podrían plantar productos
    // (con precio falso) en el catálogo de un negocio ajeno.
    await withTransaction(async (client) => {
      await moveToHuellitasAsOwner(client, USER_GROOMER)

      await expect(client.query(INSERT_SQL, [TENANT_PATITAS])).rejects.toThrow(/row-level security/)
    })
  })

  it('un UPDATE no puede mover un producto propio a otro negocio', async () => {
    // El with check de UPDATE: la fila RESULTANTE también debe pasar. Sin él,
    // el dueño de Patitas podría "regalar" un producto al catálogo de otro.
    await asUser(USER_DUENO, async (client) => {
      await expect(
        client.query('update products set tenant_id = $1 where id = $2', [
          TENANT_HUELLITAS,
          PRODUCT_ALIMENTO,
        ]),
      ).rejects.toThrow(/row-level security/)
    })
  })

  it('el visitante anónimo no ve ningún producto', async () => {
    // CLAUDE.md §7.3.3: anon no debe leer nada de negocio. Aquí lo garantiza
    // que no exista política para anon (RLS forzado): devuelve 0 filas. Si
    // alguien agregara una política abierta por error, este test falla.
    await asAnon(async (client) => {
      const { rows } = await client.query('select id from products')
      expect(rows).toHaveLength(0)
    })
  })
})

describe('products: permiso inventory por rol', () => {
  it('control: el dueño ve los productos de Patitas (activos e inactivos) y los puede crear', async () => {
    await asUser(USER_DUENO, async (client) => {
      const { rows } = await client.query('select id from products where tenant_id = $1', [
        TENANT_PATITAS,
      ])
      expect(rows).toHaveLength(3)

      const created = await client.query(INSERT_SQL, [TENANT_PATITAS])
      expect(created.rows).toHaveLength(1)
    })
  })

  it('recepción puede ver, crear y editar productos', async () => {
    // Recepción es quien cobra y da de alta lo que llega al mostrador. Si
    // perdiera el permiso, el negocio no podría vender sin llamar al dueño.
    await asUser(USER_RECEPCION, async (client) => {
      const created = await client.query(INSERT_SQL, [TENANT_PATITAS])
      const updated = await client.query('update products set price_cents = 12000 where id = $1', [
        created.rows[0].id,
      ])
      expect(updated.rowCount).toBe(1)
    })
  })

  it('el veterinario ve el catálogo pero no puede crear ni editar', async () => {
    // El vet necesita ver productos (consumo en consulta, fase 11C) pero no
    // fijar precios. Es la diferencia can_view / can_edit en la política.
    await asUser(USER_VET, async (client) => {
      const { rows } = await client.query('select id from products where tenant_id = $1', [
        TENANT_PATITAS,
      ])
      expect(rows).toHaveLength(3)

      const updated = await client.query(
        "update products set name = 'cambiado' where id = $1",
        [PRODUCT_ALIMENTO],
      )
      expect(updated.rowCount).toBe(0)
    })
    await asUser(USER_VET, async (client) => {
      await expect(client.query(INSERT_SQL, [TENANT_PATITAS])).rejects.toThrow(/row-level security/)
    })
  })

  it('el groomer no ve ningún producto ni puede crearlos', async () => {
    // La regla "groomer sin acceso" la decide la base, no un v-if: aunque
    // llame a la API directo, no obtiene el catálogo.
    await asUser(USER_GROOMER, async (client) => {
      const { rows } = await client.query('select id from products')
      expect(rows).toHaveLength(0)
    })
    await asUser(USER_GROOMER, async (client) => {
      await expect(client.query(INSERT_SQL, [TENANT_PATITAS])).rejects.toThrow(/row-level security/)
    })
  })

  it('cambiar una fila de role_permissions cambia quién puede, sin tocar código', async () => {
    // Prueba que la política usa app.has_permission() y no un rol fijo: si le
    // quitamos 'view' a recepción, deja de ver el catálogo de inmediato.
    await withTransaction(async (client) => {
      await setRole(client, 'service_role')
      await client.query(
        `update role_permissions set can_view = false, can_edit = false
          where tenant_id = $1 and role = 'receptionist' and module = 'inventory'`,
        [TENANT_PATITAS],
      )
      await setRole(client, 'authenticated', USER_RECEPCION)

      const { rows } = await client.query('select id from products')
      expect(rows).toHaveLength(0)
    })
  })
})

describe('products: borrado suave y sin DELETE', () => {
  it('el dueño puede desactivar un producto y sigue existiendo', async () => {
    // Desactivar es el flujo normal (deja de ofrecerse, se conserva el
    // historial de ventas).
    await asUser(USER_DUENO, async (client) => {
      await client.query('update products set is_active = false where id = $1', [PRODUCT_ALIMENTO])
      const { rows } = await client.query('select is_active from products where id = $1', [
        PRODUCT_ALIMENTO,
      ])
      expect(rows[0].is_active).toBe(false)
    })
  })

  it('el dueño puede hacer borrado suave (deleted_at) sin chocar con la política de SELECT', async () => {
    // Trampa de CLAUDE.md §7.2: si products_select filtrara `deleted_at is
    // null`, este UPDATE fallaría con "new row violates row-level security".
    await asUser(USER_DUENO, async (client) => {
      const { rowCount } = await client.query(
        'update products set deleted_at = now() where id = $1',
        [PRODUCT_ALIMENTO],
      )
      expect(rowCount).toBe(1)
    })
  })

  it('nadie puede borrar físicamente un producto, ni el dueño', async () => {
    // CLAUDE.md §7.3.2: sin política de DELETE, Postgres lo rechaza (0
    // filas). Si existiera, una venta histórica podría quedar apuntando a
    // un producto que ya no está.
    await asUser(USER_DUENO, async (client) => {
      const { rowCount } = await client.query('delete from products where id = $1', [
        PRODUCT_ALIMENTO,
      ])
      expect(rowCount).toBe(0)
    })
  })
})

describe('products: reglas de la tabla', () => {
  it('el código interno no se repite dentro de un negocio, ni cambiando mayúsculas', async () => {
    // Evita dos productos con el mismo SKU, que confundiría el cobro y el
    // inventario. 'ali-3kg' choca con el sembrado 'ALI-3KG'.
    await asUser(USER_DUENO, async (client) => {
      await expect(
        client.query(
          "insert into products (tenant_id, name, sku, price_cents) values ($1, 'Otro', 'ali-3kg', 100)",
          [TENANT_PATITAS],
        ),
      ).rejects.toThrow(/products_tenant_sku_key/)
    })
  })

  it('dos negocios distintos sí pueden usar el mismo código interno', async () => {
    // La unicidad es POR negocio: si fuera global, un negocio se enteraría de
    // los códigos de otro por el error al guardar.
    await withTransaction(async (client) => {
      await moveToHuellitasAsOwner(client, USER_GROOMER)
      const { rows } = await client.query(
        "insert into products (tenant_id, name, sku, price_cents) values ($1, 'Alimento', 'ALI-3KG', 100) returning id",
        [TENANT_HUELLITAS],
      )
      expect(rows).toHaveLength(1)
    })
  })

  it('el código de un producto con borrado suave se puede reutilizar', async () => {
    // Un producto dado de alta por error y "borrado" no debe bloquear el
    // código para siempre.
    await asUser(USER_DUENO, async (client) => {
      await client.query('update products set deleted_at = now() where id = $1', [PRODUCT_ALIMENTO])
      const { rows } = await client.query(
        "insert into products (tenant_id, name, sku, price_cents) values ($1, 'Nuevo', 'ALI-3KG', 100) returning id",
        [TENANT_PATITAS],
      )
      expect(rows).toHaveLength(1)
    })
  })

  it('productos sin código interno pueden repetirse (el SKU es opcional)', async () => {
    // NULL no cuenta como valor repetido: un negocio que no usa códigos debe
    // poder dar de alta varios productos.
    await asUser(USER_DUENO, async (client) => {
      await client.query(INSERT_SQL, [TENANT_PATITAS])
      const { rows } = await client.query(INSERT_SQL, [TENANT_PATITAS])
      expect(rows).toHaveLength(1)
    })
  })

  it.each([
    ['precio negativo', 'price_cents = -1'],
    ['costo negativo', 'cost_cents = -1'],
    ['stock mínimo negativo', 'min_stock = -1'],
    ['tasa de IVA negativa', 'tax_rate_bp = -1'],
    ['nombre vacío', "name = '  '"],
    ['clave de producto SAT con 7 dígitos', "sat_product_code = '1234567'"],
    ['clave de unidad SAT en minúsculas', "sat_unit_code = 'h87'"],
  ])('la base rechaza %s', async (_caso, setClause) => {
    // Último candado: aunque se llame a la API directo, un valor imposible
    // (dinero negativo, clave SAT con formato inválido) no se guarda.
    await asUser(USER_DUENO, async (client) => {
      await expect(
        client.query(`update products set ${setClause} where id = $1`, [PRODUCT_ALIMENTO]),
      ).rejects.toThrow(/violates check constraint/)
    })
  })

  it('un producto nuevo trae IVA 16 %, stock mínimo 0, activo y claves SAT por defecto', async () => {
    // Los defaults hacen que dar de alta un producto con solo nombre y precio
    // funcione, y que la factura siempre tenga claves de dónde sacar.
    await asUser(USER_DUENO, async (client) => {
      const { rows } = await client.query(
        `insert into products (tenant_id, name, price_cents) values ($1, 'Pelota', 5000)
         returning tax_rate_bp, min_stock, is_active, sat_product_code, sat_unit_code`,
        [TENANT_PATITAS],
      )
      expect(rows[0]).toEqual({
        tax_rate_bp: 1600,
        min_stock: 0,
        is_active: true,
        sat_product_code: '01010101',
        sat_unit_code: 'H87',
      })
    })
  })
})
