// RLS y reglas de la base de proveedores (fase 29B, tarea 29.2; migración
// 20261022120000_suppliers.sql). Mismos permisos que Inventario (módulo `inventory`):
// dueño y recepción ven y editan, el veterinario solo ve, el groomer no ve nada.
import { afterAll, describe, expect, it } from 'vitest'

import { asUser, closePool, setRole, withTransaction } from './helpers'
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

async function insertSupplier(client: import('pg').PoolClient, tenant = TENANT_PATITAS) {
  const { rows } = await client.query(
    "insert into suppliers (tenant_id, name, supplier_type, phone) values ($1, 'Distribuidora Norte', 'medication', '5551234567') returning id",
    [tenant],
  )
  return rows[0].id as string
}

describe('suppliers: permisos', () => {
  // Qué prueba: dueño y recepción dan de alta; es el permiso inventory:edit por defecto.
  it('dueño y recepción pueden dar de alta un proveedor', async () => {
    for (const user of [USER_DUENO, USER_RECEPCION]) {
      await withTransaction(async (client) => {
        await setRole(client, 'authenticated', user)
        const id = await insertSupplier(client)
        expect(id).toBeTruthy()
      })
    }
  })

  // Qué prueba: el veterinario ve (inventory:view) pero no escribe; el groomer ni ve.
  // Qué se rompería: el vet cambiaría datos de contacto que le tocan a compras, o el groomer
  // vería a quién se le compra y a qué costo.
  it('el veterinario lee pero no escribe; el groomer no ve nada', async () => {
    await withTransaction(async (client) => {
      await setRole(client, 'authenticated', USER_DUENO)
      const id = await insertSupplier(client)

      await setRole(client, 'authenticated', USER_VET)
      const read = await client.query('select id from suppliers where id = $1', [id])
      expect(read.rows).toHaveLength(1)
      await client.query('savepoint s')
      await expect(
        client.query(
          "insert into suppliers (tenant_id, name) values ($1, 'No debería')",
          [TENANT_PATITAS],
        ),
      ).rejects.toThrow(/row-level security/i)
      await client.query('rollback to savepoint s')

      await setRole(client, 'authenticated', USER_GROOMER)
      const hidden = await client.query('select id from suppliers where id = $1', [id])
      expect(hidden.rows).toHaveLength(0)
    })
  })

  // Qué prueba: un negocio no ve los proveedores de otro.
  it('no se ven entre negocios', async () => {
    await withTransaction(async (client) => {
      await setRole(client, 'service_role')
      await insertSupplier(client, TENANT_HUELLITAS)
      const { rows } = await asUser(USER_DUENO, (c) =>
        c.query('select id from suppliers where tenant_id = $1', [TENANT_HUELLITAS]),
      )
      expect(rows).toHaveLength(0)
    })
  })

  // Qué prueba: el nombre no se repite en el negocio (sin importar mayúsculas), y uno
  // oculto libera el suyo.
  it('no repite el nombre, pero un proveedor oculto libera el suyo', async () => {
    await withTransaction(async (client) => {
      await setRole(client, 'authenticated', USER_DUENO)
      const id = await insertSupplier(client)

      await client.query('savepoint s')
      await expect(
        client.query(
          "insert into suppliers (tenant_id, name) values ($1, 'DISTRIBUIDORA norte')",
          [TENANT_PATITAS],
        ),
      ).rejects.toThrow(/duplicate key|unique/i)
      await client.query('rollback to savepoint s')

      await client.query('update suppliers set deleted_at = now() where id = $1', [id])
      const again = await client.query(
        "insert into suppliers (tenant_id, name) values ($1, 'Distribuidora Norte') returning id",
        [TENANT_PATITAS],
      )
      expect(again.rows).toHaveLength(1)
    })
  })
})

describe('product_suppliers: un producto, varios proveedores', () => {
  // Qué prueba: que un producto admite varios proveedores y un proveedor varios productos.
  it('un producto puede tener varios proveedores', async () => {
    await withTransaction(async (client) => {
      await setRole(client, 'authenticated', USER_DUENO)
      const countLinks = async () =>
        (
          await client.query(
            'select count(*)::int as n from product_suppliers where product_id = $1 and deleted_at is null',
            [PRODUCT_ALIMENTO],
          )
        ).rows[0].n as number
      // La semilla ya liga el alimento a dos proveedores: se compara contra lo que hay.
      const before = await countLinks()

      const a = await insertSupplier(client)
      const b = (
        await client.query(
          "insert into suppliers (tenant_id, name) values ($1, 'Otro proveedor') returning id",
          [TENANT_PATITAS],
        )
      ).rows[0].id
      for (const supplier of [a, b]) {
        await client.query(
          'insert into product_suppliers (tenant_id, product_id, supplier_id) values ($1, $2, $3)',
          [TENANT_PATITAS, PRODUCT_ALIMENTO, supplier],
        )
      }
      expect(await countLinks()).toBe(before + 2)
    })
  })

  // Qué prueba: el mismo vínculo no se repite, pero se puede quitar y volver a agregar.
  it('no repite el vínculo; quitarlo permite volver a agregarlo', async () => {
    await withTransaction(async (client) => {
      await setRole(client, 'authenticated', USER_DUENO)
      const supplier = await insertSupplier(client)
      const link = await client.query(
        'insert into product_suppliers (tenant_id, product_id, supplier_id) values ($1, $2, $3) returning id',
        [TENANT_PATITAS, PRODUCT_ALIMENTO, supplier],
      )

      await client.query('savepoint s')
      await expect(
        client.query(
          'insert into product_suppliers (tenant_id, product_id, supplier_id) values ($1, $2, $3)',
          [TENANT_PATITAS, PRODUCT_ALIMENTO, supplier],
        ),
      ).rejects.toThrow(/duplicate key|unique/i)
      await client.query('rollback to savepoint s')

      await client.query(
        'update product_suppliers set deleted_at = now() where id = $1',
        [link.rows[0].id],
      )
      const again = await client.query(
        'insert into product_suppliers (tenant_id, product_id, supplier_id) values ($1, $2, $3) returning id',
        [TENANT_PATITAS, PRODUCT_ALIMENTO, supplier],
      )
      expect(again.rows).toHaveLength(1)
    })
  })

  // Qué prueba: un vínculo no mezcla negocios: ni el producto ni el proveedor de otro
  // negocio (llaves compuestas).
  // Qué se rompería: un proveedor vería los productos de otro negocio por el vínculo.
  it('rechaza un producto o un proveedor de otro negocio', async () => {
    await withTransaction(async (client) => {
      await setRole(client, 'service_role')
      const ajeno = await insertSupplier(client, TENANT_HUELLITAS)
      const propio = await insertSupplier(client)

      await client.query('savepoint s')
      await expect(
        client.query(
          'insert into product_suppliers (tenant_id, product_id, supplier_id) values ($1, $2, $3)',
          [TENANT_PATITAS, PRODUCT_ALIMENTO, ajeno],
        ),
      ).rejects.toThrow(/foreign key/i)
      await client.query('rollback to savepoint s')

      await client.query('savepoint s')
      await expect(
        client.query(
          'insert into product_suppliers (tenant_id, product_id, supplier_id) values ($1, $2, $3)',
          [TENANT_PATITAS, PRODUCT_HUELLITAS, propio],
        ),
      ).rejects.toThrow(/foreign key/i)
      await client.query('rollback to savepoint s')
    })
  })

  // Qué prueba: recepción (que sí edita inventario) también administra los vínculos.
  it('la recepción puede ligar un producto a un proveedor', async () => {
    await withTransaction(async (client) => {
      await setRole(client, 'authenticated', USER_RECEPCION)
      const supplier = await insertSupplier(client)
      const { rows } = await client.query(
        'insert into product_suppliers (tenant_id, product_id, supplier_id) values ($1, $2, $3) returning id',
        [TENANT_PATITAS, PRODUCT_ALIMENTO, supplier],
      )
      expect(rows).toHaveLength(1)
    })
  })
})
