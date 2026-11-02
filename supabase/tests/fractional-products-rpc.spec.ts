// Medicamentos fraccionados (fase 29C, PLAN.md D30 punto 5; migración
// 20261023120000_fractional_products.sql): presentación del producto, venta por unidad o por
// envase, consumo en consulta y reporte.
//
// Qué se protege: que la existencia SIEMPRE esté en unidades base y cuadre con lo vendido,
// aunque se mezclen envases completos y unidades sueltas, y que un producto que no se
// fracciona se comporte exactamente como antes.
import { afterAll, describe, expect, it } from 'vitest'
import type { PoolClient } from 'pg'

import { closePool, setRole, withTransaction } from './helpers'
import {
  BRANCH_CENTRO,
  BRANCH_DEL_VALLE,
  CUSTOMER_SOFIA,
  PET_ROCKY,
  PRODUCT_ALIMENTO,
  PRODUCT_SHAMPOO,
  TENANT_PATITAS,
  USER_DUENO,
  USER_GROOMER,
  USER_RECEPCION,
  USER_VET,
} from './fixtures'

afterAll(closePool)

const CASH = [{ method: 'cash', amount_cents: 100000 }]

async function seedStock(
  client: PoolClient,
  productId: string,
  quantity: number,
  branch = BRANCH_CENTRO,
) {
  await setRole(client, 'service_role')
  await client.query(
    `insert into stock_movements (tenant_id, branch_id, product_id, created_by, movement_type, quantity)
     values ($1, $2, $3, $4, 'purchase', $5)`,
    [TENANT_PATITAS, branch, productId, USER_DUENO, quantity],
  )
}

async function stockOf(
  client: PoolClient,
  productId: string,
  branch = BRANCH_CENTRO,
): Promise<number> {
  await setRole(client, 'service_role')
  const { rows } = await client.query(
    'select coalesce(sum(quantity), 0)::int as stock from stock_movements where product_id = $1 and branch_id = $2',
    [productId, branch],
  )
  return rows[0].stock
}

/** El shampoo de la semilla (precio $145.00) pasa a caja de 20 tabletas. */
async function presentation(
  client: PoolClient,
  user: string,
  units = 20,
  { unitPrice = null as number | null, product = PRODUCT_SHAMPOO } = {},
) {
  await setRole(client, 'authenticated', user)
  const { rows } = await client.query(
    "select * from set_product_presentation($1, $2, 'caja', 'tableta', $3, 'H87')",
    [product, units, unitPrice],
  )
  return rows[0]
}

async function counterSale(client: PoolClient, products: unknown[], payments = CASH) {
  await setRole(client, 'authenticated', USER_DUENO)
  const { rows } = await client.query(
    'select checkout_counter_sale($1, $2, $3::jsonb, $4::jsonb) as id',
    [BRANCH_CENTRO, CUSTOMER_SOFIA, JSON.stringify(products), JSON.stringify(payments)],
  )
  return rows[0].id as string
}

async function saleItems(client: PoolClient, saleId: string) {
  await setRole(client, 'service_role')
  const { rows } = await client.query(
    `select description, quantity, unit_price_cents, line_total_cents, sold_unit,
            units_per_package_snapshot, sat_unit_code_snapshot
       from sale_items where sale_id = $1 order by created_at`,
    [saleId],
  )
  return rows
}

describe('set_product_presentation(): presentación y reescalado de la existencia', () => {
  // Qué prueba: pasar de "3 cajas" a "caja de 20 tabletas" deja 60 tabletas, con un ajuste
  // en la bitácora y sin perder nada.
  // Qué se rompería: el inventario diría 3 tabletas donde había 3 cajas (o al revés).
  it('reescala la existencia y registra un ajuste por sucursal', async () => {
    await withTransaction(async (client) => {
      await seedStock(client, PRODUCT_SHAMPOO, 3)
      await seedStock(client, PRODUCT_SHAMPOO, 2, BRANCH_DEL_VALLE)

      const product = await presentation(client, USER_DUENO, 20)

      expect(product).toMatchObject({
        units_per_package: 20,
        package_name: 'caja',
        unit_name: 'tableta',
      })
      expect(await stockOf(client, PRODUCT_SHAMPOO)).toBe(60)
      expect(await stockOf(client, PRODUCT_SHAMPOO, BRANCH_DEL_VALLE)).toBe(40)

      const adjustments = await client.query(
        `select quantity, reason from stock_movements
          where product_id = $1 and movement_type = 'adjustment' order by quantity`,
        [PRODUCT_SHAMPOO],
      )
      expect(adjustments.rows.map((r) => r.quantity)).toEqual([38, 57])
      expect(adjustments.rows[0].reason).toMatch(/Cambio de presentación/)
    })
  })

  // Qué prueba: el aviso de "stock bajo" se reescala igual (en unidades base).
  it('reescala el aviso de stock bajo', async () => {
    await withTransaction(async (client) => {
      await setRole(client, 'service_role')
      await client.query('update products set min_stock = 2 where id = $1', [
        PRODUCT_SHAMPOO,
      ])
      const product = await presentation(client, USER_DUENO, 10)
      expect(product.min_stock).toBe(20)
    })
  })

  // Qué prueba: si el reescalado no da entero, se rechaza y no cambia nada (20 → 3 con 5
  // tabletas sueltas dejaría 0.75).
  // Qué se rompería: la existencia se redondearía en silencio y el inventario perdería piezas.
  it('rechaza un cambio que no da unidades enteras y no toca nada', async () => {
    await withTransaction(async (client) => {
      await seedStock(client, PRODUCT_SHAMPOO, 1)
      await presentation(client, USER_DUENO, 20)
      await setRole(client, 'service_role')
      await client.query(
        `insert into stock_movements (tenant_id, branch_id, product_id, created_by, movement_type, quantity, reason)
         values ($1, $2, $3, $4, 'loss', -15, 'Se cayeron')`,
        [TENANT_PATITAS, BRANCH_CENTRO, PRODUCT_SHAMPOO, USER_DUENO],
      ) // quedan 5 tabletas

      await client.query('savepoint s')
      await expect(presentation(client, USER_DUENO, 3)).rejects.toThrow(
        /no caben exactas/i,
      )
      await client.query('rollback to savepoint s')

      expect(await stockOf(client, PRODUCT_SHAMPOO)).toBe(5)
    })
  })

  // Qué prueba: pedir unidades por envase sin nombre de unidad se rechaza (el ticket diría "()").
  it('exige el nombre de la unidad cuando se fracciona', async () => {
    await withTransaction(async (client) => {
      await setRole(client, 'authenticated', USER_DUENO)
      await client.query('savepoint s')
      await expect(
        client.query('select * from set_product_presentation($1, 20)', [PRODUCT_SHAMPOO]),
      ).rejects.toThrow(/cómo se llama la unidad/i)
      await client.query('rollback to savepoint s')
    })
  })

  // Qué prueba: solo quien edita inventario (dueño y recepción); el vet y el groomer no.
  it('solo dueño y recepción pueden cambiar la presentación', async () => {
    await withTransaction(async (client) => {
      await presentation(client, USER_RECEPCION, 10) // recepción: inventory:edit
      for (const user of [USER_VET, USER_GROOMER]) {
        await client.query('savepoint s')
        await expect(presentation(client, user, 5)).rejects.toThrow(/permiso/i)
        await client.query('rollback to savepoint s')
      }
    })
  })

  // Qué prueba: volver a 1 unidad por envase quita nombres y precio de unidad.
  it('volver a un envase sin fraccionar limpia lo de la unidad', async () => {
    await withTransaction(async (client) => {
      await presentation(client, USER_DUENO, 20, { unitPrice: 800 })
      await setRole(client, 'authenticated', USER_DUENO)
      const { rows } = await client.query(
        'select * from set_product_presentation($1, 1)',
        [PRODUCT_SHAMPOO],
      )
      expect(rows[0]).toMatchObject({
        units_per_package: 1,
        unit_name: null,
        package_name: null,
        unit_price_cents: null,
      })
    })
  })
})

describe('venta por unidad o por envase', () => {
  // Qué prueba: vender 3 tabletas baja 3 (no 1 caja), con el precio de unidad calculado
  // ($145.00 / 20 = $7.25) y la partida marcada como unidad.
  // Qué se rompería: el cliente pagaría una caja entera por tres tabletas, o el inventario
  // bajaría una caja.
  it('vender 3 unidades baja 3 unidades y cobra el precio de la unidad', async () => {
    await withTransaction(async (client) => {
      await seedStock(client, PRODUCT_SHAMPOO, 3)
      await presentation(client, USER_DUENO, 20)

      const saleId = await counterSale(client, [
        { product_id: PRODUCT_SHAMPOO, quantity: 3, unit: 'unit' },
      ])

      expect(await stockOf(client, PRODUCT_SHAMPOO)).toBe(57)
      const [item] = await saleItems(client, saleId)
      expect(item).toMatchObject({
        description: expect.stringContaining('(tableta)'),
        quantity: 3,
        unit_price_cents: 725,
        line_total_cents: 2175,
        sold_unit: 'unit',
        units_per_package_snapshot: 20,
        sat_unit_code_snapshot: 'H87',
      })
    })
  })

  // Qué prueba: por defecto se vende el envase completo, y baja sus 20 unidades.
  it('vender el envase (por defecto) baja todas sus unidades', async () => {
    await withTransaction(async (client) => {
      await seedStock(client, PRODUCT_SHAMPOO, 3)
      await presentation(client, USER_DUENO, 20)

      const saleId = await counterSale(client, [
        { product_id: PRODUCT_SHAMPOO, quantity: 1 },
      ])

      expect(await stockOf(client, PRODUCT_SHAMPOO)).toBe(40)
      const [item] = await saleItems(client, saleId)
      expect(item).toMatchObject({
        sold_unit: 'package',
        unit_price_cents: 14500,
        quantity: 1,
      })
    })
  })

  // Qué prueba: mezclar un envase y unidades sueltas en el mismo ticket cuadra: el total es la
  // suma de partidas y la existencia baja 20 + 5.
  it('un envase y unidades sueltas en el mismo ticket cuadran', async () => {
    await withTransaction(async (client) => {
      await seedStock(client, PRODUCT_SHAMPOO, 2)
      await presentation(client, USER_DUENO, 20)

      const saleId = await counterSale(client, [
        { product_id: PRODUCT_SHAMPOO, quantity: 1 },
        { product_id: PRODUCT_SHAMPOO, quantity: 5, unit: 'unit' },
      ])

      expect(await stockOf(client, PRODUCT_SHAMPOO)).toBe(40 - 25)
      const items = await saleItems(client, saleId)
      expect(items.reduce((sum, i) => sum + i.line_total_cents, 0)).toBe(14500 + 5 * 725)
    })
  })

  // Qué prueba: el precio de la unidad fijado en el producto manda sobre el cálculo, y el de
  // la venta manda sobre los dos.
  it('el precio de la unidad se puede fijar en el producto y corregir en la venta', async () => {
    await withTransaction(async (client) => {
      await seedStock(client, PRODUCT_SHAMPOO, 3)
      await presentation(client, USER_DUENO, 20, { unitPrice: 800 })

      const a = await counterSale(client, [
        { product_id: PRODUCT_SHAMPOO, quantity: 2, unit: 'unit' },
      ])
      const b = await counterSale(client, [
        {
          product_id: PRODUCT_SHAMPOO,
          quantity: 2,
          unit: 'unit',
          unit_price_cents: 1000,
        },
      ])

      expect((await saleItems(client, a))[0].unit_price_cents).toBe(800)
      expect((await saleItems(client, b))[0].unit_price_cents).toBe(1000)
    })
  })

  // Qué prueba: pedir más unidades de las que hay se rechaza con un mensaje claro y no
  // queda nada guardado.
  it('rechaza pedir más unidades de las que hay', async () => {
    await withTransaction(async (client) => {
      await seedStock(client, PRODUCT_SHAMPOO, 1) // 20 tabletas
      await presentation(client, USER_DUENO, 20)

      await client.query('savepoint s')
      await expect(
        counterSale(client, [
          { product_id: PRODUCT_SHAMPOO, quantity: 21, unit: 'unit' },
        ]),
      ).rejects.toThrow(/no hay existencia suficiente/i)
      await client.query('rollback to savepoint s')

      expect(await stockOf(client, PRODUCT_SHAMPOO)).toBe(20)
    })
  })

  // Qué prueba: un producto que no se fracciona no se vende por unidad.
  it('un producto sin presentación no se vende por unidad', async () => {
    await withTransaction(async (client) => {
      await seedStock(client, PRODUCT_ALIMENTO, 5)
      await client.query('savepoint s')
      await expect(
        counterSale(client, [
          { product_id: PRODUCT_ALIMENTO, quantity: 1, unit: 'unit' },
        ]),
      ).rejects.toThrow(/no se vende por unidad/i)
      await client.query('rollback to savepoint s')
    })
  })

  // Qué prueba: un producto sin presentación se vende igual que antes (regresión).
  it('un producto sin presentación se comporta como siempre', async () => {
    await withTransaction(async (client) => {
      await seedStock(client, PRODUCT_ALIMENTO, 5)
      const saleId = await counterSale(client, [
        { product_id: PRODUCT_ALIMENTO, quantity: 2 },
      ])
      expect(await stockOf(client, PRODUCT_ALIMENTO)).toBe(3)
      expect((await saleItems(client, saleId))[0]).toMatchObject({
        quantity: 2,
        sold_unit: 'package',
        units_per_package_snapshot: 1,
      })
    })
  })

  // Qué prueba: cancelar una venta por unidades devuelve exactamente esas unidades.
  // Qué se rompería: la devolución regresaría cajas o piezas de menos.
  it('cancelar la venta devuelve las unidades vendidas', async () => {
    await withTransaction(async (client) => {
      await seedStock(client, PRODUCT_SHAMPOO, 3)
      await presentation(client, USER_DUENO, 20)
      const saleId = await counterSale(client, [
        { product_id: PRODUCT_SHAMPOO, quantity: 7, unit: 'unit' },
      ])
      expect(await stockOf(client, PRODUCT_SHAMPOO)).toBe(53)

      await setRole(client, 'service_role')
      await client.query("update sales set status = 'cancelled' where id = $1", [saleId])
      expect(await stockOf(client, PRODUCT_SHAMPOO)).toBe(60)
    })
  })
})

describe('consumo en consulta por unidad', () => {
  async function seedVetAppointment(client: PoolClient): Promise<string> {
    await setRole(client, 'service_role')
    const { rows } = await client.query(
      `insert into appointments (tenant_id, branch_id, customer_id, pet_id, kind, employee_user_id, starts_at, ends_at, status, created_by)
       values ($1, $2, $3, $4, 'veterinary', $5, now() + interval '30 days', now() + interval '30 days' + interval '60 minutes', 'in_progress', $5)
       returning id`,
      [TENANT_PATITAS, BRANCH_DEL_VALLE, CUSTOMER_SOFIA, PET_ROCKY, USER_VET],
    )
    return rows[0].id
  }

  // Qué prueba: el veterinario usa 4 tabletas: baja 4, la línea queda como unidad con su
  // precio, y al quitarla regresan las 4.
  it('usar unidades baja unidades y quitarlas las devuelve', async () => {
    await withTransaction(async (client) => {
      await seedStock(client, PRODUCT_SHAMPOO, 2, BRANCH_DEL_VALLE)
      await presentation(client, USER_DUENO, 20)
      const appointmentId = await seedVetAppointment(client)

      await setRole(client, 'authenticated', USER_VET)
      const { rows } = await client.query(
        "select add_appointment_product($1, $2, 4, true, 'unit') as id",
        [appointmentId, PRODUCT_SHAMPOO],
      )
      const lineId = rows[0].id

      expect(await stockOf(client, PRODUCT_SHAMPOO, BRANCH_DEL_VALLE)).toBe(36)
      await setRole(client, 'service_role')
      const line = await client.query(
        'select name_snapshot, unit_price_cents, quantity, sold_unit from appointment_products where id = $1',
        [lineId],
      )
      expect(line.rows[0]).toMatchObject({
        quantity: 4,
        unit_price_cents: 725,
        sold_unit: 'unit',
      })
      expect(line.rows[0].name_snapshot).toContain('(tableta)')

      await setRole(client, 'authenticated', USER_VET)
      await client.query('select remove_appointment_product($1)', [lineId])
      expect(await stockOf(client, PRODUCT_SHAMPOO, BRANCH_DEL_VALLE)).toBe(40)
    })
  })

  // Qué prueba: el insumo cobrable llega al ticket con su unidad y su precio de unidad, sin
  // descontar de nuevo la existencia.
  it('el insumo por unidad pasa al ticket como unidad, sin descontar otra vez', async () => {
    await withTransaction(async (client) => {
      await seedStock(client, PRODUCT_SHAMPOO, 2, BRANCH_DEL_VALLE)
      await presentation(client, USER_DUENO, 20)
      const appointmentId = await seedVetAppointment(client)

      await setRole(client, 'authenticated', USER_VET)
      await client.query("select add_appointment_product($1, $2, 3, true, 'unit')", [
        appointmentId,
        PRODUCT_SHAMPOO,
      ])
      expect(await stockOf(client, PRODUCT_SHAMPOO, BRANCH_DEL_VALLE)).toBe(37)

      await setRole(client, 'service_role')
      await client.query("update appointments set status = 'completed' where id = $1", [
        appointmentId,
      ])
      await client.query(
        `insert into appointment_services (tenant_id, appointment_id, service_id, name_snapshot, unit_price_cents, quantity, duration_minutes_snapshot)
         select $1, $2, id, name, price_cents, 1, duration_minutes from services where tenant_id = $1 limit 1`,
        [TENANT_PATITAS, appointmentId],
      )

      await setRole(client, 'authenticated', USER_DUENO)
      const { rows } = await client.query(
        'select checkout_appointment($1, $2::jsonb, 0, $3::jsonb) as id',
        [appointmentId, JSON.stringify(CASH), '[]'],
      )

      const items = await saleItems(client, rows[0].id)
      const supply = items.find((i) => i.sold_unit === 'unit')
      expect(supply).toMatchObject({
        quantity: 3,
        unit_price_cents: 725,
        sat_unit_code_snapshot: 'H87',
      })
      expect(await stockOf(client, PRODUCT_SHAMPOO, BRANCH_DEL_VALLE)).toBe(37) // sin descuento doble
    })
  })
})

describe('report_top_items(): no mezcla envases con unidades', () => {
  // Qué prueba: el mismo producto vendido por envase y por unidad sale en dos renglones.
  // Qué se rompería: el reporte diría "4 vendidos" sumando una caja y tres tabletas.
  it('separa el producto vendido por envase del vendido por unidad', async () => {
    await withTransaction(async (client) => {
      await seedStock(client, PRODUCT_SHAMPOO, 3)
      await presentation(client, USER_DUENO, 20)
      await counterSale(client, [
        { product_id: PRODUCT_SHAMPOO, quantity: 1 },
        { product_id: PRODUCT_SHAMPOO, quantity: 3, unit: 'unit' },
      ])

      await setRole(client, 'authenticated', USER_DUENO)
      const { rows } = await client.query(
        `select report_top_items($1, current_date - 1, current_date + 1) as r`,
        [TENANT_PATITAS],
      )
      const rowsOfProduct = (
        rows[0].r.products as Array<{
          item_id: string
          sold_unit: string
          quantity: number
        }>
      )
        .filter((p) => p.item_id === PRODUCT_SHAMPOO)
        .sort((a, b) => a.sold_unit.localeCompare(b.sold_unit))
      expect(rowsOfProduct.map((r) => [r.sold_unit, r.quantity])).toEqual([
        ['package', 1],
        ['unit', 3],
      ])
    })
  })
})
