// Prueba la venta de productos en el cobro (fase 11, tareas 11.10 y 11.11 /
// HMH Four #2041): checkout_appointment() con productos, checkout_counter_sale()
// (venta de mostrador sin cita), la baja y devolución de existencias, y la forma
// de pago con tarjeta.
//
// Mismo patrón que checkout-rpc.spec.ts: sesión simulada con pg dentro de una
// transacción que siempre se revierte, así ningún test deja rastro.
import { afterAll, describe, expect, it } from 'vitest'
import type { PoolClient } from 'pg'

import { sumLineItems } from '@/lib/money'

import { closePool, setRole, withTransaction } from './helpers'
import {
  BRANCH_CENTRO,
  BRANCH_DEL_VALLE,
  CUSTOMER_FERNANDA,
  CUSTOMER_SOFIA,
  PET_ROCKY,
  PRODUCT_ALIMENTO,
  PRODUCT_COLLAR_INACTIVO,
  PRODUCT_HUELLITAS,
  PRODUCT_SHAMPOO,
  SERVICE_BANO,
  TENANT_PATITAS,
  USER_DUENO,
  USER_GROOMER,
  USER_RECEPCION,
} from './fixtures'

afterAll(closePool)

type Payment = { method: string; amount_cents: number; payment_form_code?: string }
type ProductLine = { product_id: string; quantity: number }

/** Mete existencia saltándose RLS: solo arma el escenario del test. */
async function seedStock(
  client: PoolClient,
  productId: string,
  quantity: number,
  branchId = BRANCH_CENTRO,
) {
  await setRole(client, 'service_role')
  await client.query(
    `insert into stock_movements (tenant_id, branch_id, product_id, created_by, movement_type, quantity)
     values ($1, $2, $3, $4, 'purchase', $5)`,
    [TENANT_PATITAS, branchId, productId, USER_DUENO, quantity],
  )
}

async function stockOf(
  client: PoolClient,
  productId: string,
  branchId = BRANCH_CENTRO,
): Promise<number> {
  const { rows } = await client.query(
    'select coalesce(sum(quantity), 0)::int as stock from stock_movements where product_id = $1 and branch_id = $2',
    [productId, branchId],
  )
  return rows[0].stock
}

async function seedCompletedAppointment(client: PoolClient): Promise<string> {
  await setRole(client, 'service_role')
  const { rows } = await client.query(
    `insert into appointments (tenant_id, branch_id, customer_id, pet_id, kind, employee_user_id, starts_at, ends_at, status, created_by)
     values ($1, $2, $3, $4, 'grooming', $5, now() + interval '30 days', now() + interval '30 days' + interval '60 minutes', 'completed', $5)
     returning id`,
    [TENANT_PATITAS, BRANCH_CENTRO, CUSTOMER_SOFIA, PET_ROCKY, USER_GROOMER],
  )
  await client.query(
    `insert into appointment_services (tenant_id, appointment_id, service_id, name_snapshot, unit_price_cents, quantity, duration_minutes_snapshot)
     select $1, $2, id, name, price_cents, 1, duration_minutes from services where id = $3`,
    [TENANT_PATITAS, rows[0].id, SERVICE_BANO],
  )
  return rows[0].id
}

async function checkoutAppointment(
  client: PoolClient,
  appointmentId: string,
  payments: Payment[],
  products: ProductLine[],
): Promise<string> {
  const { rows } = await client.query(
    'select checkout_appointment($1, $2::jsonb, 0, $3::jsonb) as sale_id',
    [appointmentId, JSON.stringify(payments), JSON.stringify(products)],
  )
  return rows[0].sale_id
}

async function counterSale(
  client: PoolClient,
  products: ProductLine[],
  payments: Payment[],
  {
    branch = BRANCH_CENTRO,
    customer = CUSTOMER_SOFIA,
  }: { branch?: string; customer?: string | null } = {},
): Promise<string> {
  const { rows } = await client.query(
    'select checkout_counter_sale($1, $2, $3::jsonb, $4::jsonb) as sale_id',
    [branch, customer, JSON.stringify(products), JSON.stringify(payments)],
  )
  return rows[0].sale_id
}

async function productPrice(client: PoolClient, productId: string) {
  const { rows } = await client.query(
    'select price_cents, tax_rate_bp from products where id = $1',
    [productId],
  )
  return {
    unitPriceCents: rows[0].price_cents as number,
    taxRateBp: rows[0].tax_rate_bp as number,
  }
}

describe('venta mixta: servicio + producto en un mismo ticket', () => {
  it('cuadra al centavo y baja la existencia exacta', async () => {
    // Qué prueba: el IVA se calcula por partida (servicio y producto) y se suma.
    // Qué se rompería: un ticket con diferencia de un centavo contra lo que
    // muestra la pantalla, o piezas que no bajan al pagar.
    await withTransaction(async (client) => {
      await seedStock(client, PRODUCT_ALIMENTO, 10)
      const appointmentId = await seedCompletedAppointment(client)
      const food = await productPrice(client, PRODUCT_ALIMENTO)

      await setRole(client, 'authenticated', USER_RECEPCION)
      const bath = 25000
      const expected = sumLineItems([
        { quantity: 1, unitPriceCents: bath, taxRateBp: 1600 },
        { quantity: 3, ...food },
      ])
      const saleId = await checkoutAppointment(
        client,
        appointmentId,
        [{ method: 'cash', amount_cents: expected.totalCents }],
        [{ product_id: PRODUCT_ALIMENTO, quantity: 3 }],
      )

      const { rows } = await client.query(
        'select subtotal_cents, tax_cents, total_cents from sales where id = $1',
        [saleId],
      )
      expect(rows[0]).toMatchObject({
        subtotal_cents: expected.subtotalCents,
        tax_cents: expected.taxCents,
        total_cents: expected.totalCents,
      })
      const { rows: items } = await client.query(
        'select item_type from sale_items where sale_id = $1 order by item_type',
        [saleId],
      )
      expect(items.map((i) => i.item_type)).toEqual(['service', 'product'])
      expect(await stockOf(client, PRODUCT_ALIMENTO)).toBe(7)
    })
  })
})

describe('venta de mostrador (sin cita)', () => {
  it('cobra solo productos, deja la venta sin cita y baja la existencia', async () => {
    // Qué se rompería: un cliente que solo compra alimento no podría cobrarse.
    await withTransaction(async (client) => {
      await seedStock(client, PRODUCT_SHAMPOO, 5)
      const shampoo = await productPrice(client, PRODUCT_SHAMPOO)
      const total = sumLineItems([{ quantity: 2, ...shampoo }]).totalCents

      await setRole(client, 'authenticated', USER_RECEPCION)
      const saleId = await counterSale(
        client,
        [{ product_id: PRODUCT_SHAMPOO, quantity: 2 }],
        [{ method: 'cash', amount_cents: total }],
      )

      const { rows } = await client.query(
        'select count(*)::int as n, count(appointment_id)::int as with_appointment from sale_items where sale_id = $1',
        [saleId],
      )
      expect(rows[0]).toEqual({ n: 1, with_appointment: 0 })
      expect(await stockOf(client, PRODUCT_SHAMPOO)).toBe(3)
    })
  })

  it('cobra sin cliente registrado: la venta queda sin cliente y cuenta en reportes y existencias', async () => {
    // Qué se rompería: la venta libre (fase 13) fallaría con "customer_id nulo" y recepción
    // tendría que inventar un cliente para vender un shampoo; o, peor, la venta se guardaría
    // pero desaparecería de los totales de reportes por un join mal hecho.
    await withTransaction(async (client) => {
      await seedStock(client, PRODUCT_SHAMPOO, 5)
      const shampoo = await productPrice(client, PRODUCT_SHAMPOO)
      const total = sumLineItems([{ quantity: 1, ...shampoo }]).totalCents

      await setRole(client, 'authenticated', USER_RECEPCION)
      const saleId = await counterSale(
        client,
        [{ product_id: PRODUCT_SHAMPOO, quantity: 1 }],
        [{ method: 'cash', amount_cents: total }],
        { customer: null },
      )

      const { rows } = await client.query(
        'select customer_id, status, total_cents from sales where id = $1',
        [saleId],
      )
      expect(rows[0]).toEqual({ customer_id: null, status: 'paid', total_cents: total })
      expect(await stockOf(client, PRODUCT_SHAMPOO)).toBe(4)

      // El reporte agrega en SQL y no debe perder la venta por no tener cliente.
      await setRole(client, 'authenticated', USER_DUENO)
      const { rows: report } = await client.query(
        `select report_sales_summary($1, current_date - 1, current_date + 1, $2) as r`,
        [TENANT_PATITAS, BRANCH_CENTRO],
      )
      expect(report[0].r.totals.total_cents).toBeGreaterThanOrEqual(total)
    })
  })

  it('el groomer no puede cobrar', async () => {
    // Qué se rompería: cualquier empleado podría vender y mover inventario.
    await withTransaction(async (client) => {
      await seedStock(client, PRODUCT_SHAMPOO, 5)
      await setRole(client, 'authenticated', USER_GROOMER)
      await client.query('savepoint s')
      await expect(
        counterSale(
          client,
          [{ product_id: PRODUCT_SHAMPOO, quantity: 1 }],
          [{ method: 'cash', amount_cents: 99999 }],
        ),
      ).rejects.toThrow(/permiso para cobrar/i)
    })
  })

  it('recepción de Centro no vende en otra sucursal', async () => {
    // Qué se rompería: descontar existencia de una sucursal ajena.
    await withTransaction(async (client) => {
      await seedStock(client, PRODUCT_SHAMPOO, 5, BRANCH_DEL_VALLE)
      await setRole(client, 'authenticated', USER_RECEPCION)
      await expect(
        counterSale(
          client,
          [{ product_id: PRODUCT_SHAMPOO, quantity: 1 }],
          [{ method: 'cash', amount_cents: 99999 }],
          { branch: BRANCH_DEL_VALLE },
        ),
      ).rejects.toThrow(/acceso a esta sucursal/i)
    })
  })

  it('rechaza el cliente de otro negocio', async () => {
    // Qué se rompería: una venta de Patitas ligada a un cliente de Huellitas.
    await withTransaction(async (client) => {
      await seedStock(client, PRODUCT_SHAMPOO, 5)
      await setRole(client, 'authenticated', USER_RECEPCION)
      await expect(
        counterSale(
          client,
          [{ product_id: PRODUCT_SHAMPOO, quantity: 1 }],
          [{ method: 'cash', amount_cents: 99999 }],
          { customer: CUSTOMER_FERNANDA },
        ),
      ).rejects.toThrow(/cliente no existe/i)
    })
  })

  it('exige al menos un producto', async () => {
    await withTransaction(async (client) => {
      await setRole(client, 'authenticated', USER_RECEPCION)
      await expect(
        counterSale(client, [], [{ method: 'cash', amount_cents: 100 }]),
      ).rejects.toThrow(/al menos un producto/i)
    })
  })
})

describe('existencias al cobrar', () => {
  it('rechaza un producto con existencia 0 y no deja nada escrito', async () => {
    // Qué se rompería: vender lo que no hay y dejar existencia negativa.
    await withTransaction(async (client) => {
      const { rows: before } = await client.query('select count(*)::int as n from sales')
      await setRole(client, 'authenticated', USER_RECEPCION)
      await client.query('savepoint before_sale')
      await expect(
        counterSale(
          client,
          [{ product_id: PRODUCT_ALIMENTO, quantity: 1 }],
          [{ method: 'cash', amount_cents: 99999 }],
        ),
      ).rejects.toThrow(/no tiene existencia/i)
      await client.query('rollback to savepoint before_sale')
      await setRole(client, 'service_role') // mismo rol que al contar "antes"
      const { rows: after } = await client.query('select count(*)::int as n from sales')
      expect(after[0].n).toBe(before[0].n)
      expect(await stockOf(client, PRODUCT_ALIMENTO)).toBe(0)
    })
  })

  it('rechaza una cantidad mayor a la existencia', async () => {
    await withTransaction(async (client) => {
      await seedStock(client, PRODUCT_ALIMENTO, 2)
      await setRole(client, 'authenticated', USER_RECEPCION)
      await expect(
        counterSale(
          client,
          [{ product_id: PRODUCT_ALIMENTO, quantity: 3 }],
          [{ method: 'cash', amount_cents: 999999 }],
        ),
      ).rejects.toThrow(/no hay existencia suficiente/i)
    })
  })

  it('rechaza un producto de otro negocio y uno inactivo', async () => {
    // Qué se rompería: el RPC salta RLS; sin su propio filtro vendería ajeno.
    await withTransaction(async (client) => {
      await setRole(client, 'authenticated', USER_RECEPCION)
      await client.query('savepoint s1')
      await expect(
        counterSale(
          client,
          [{ product_id: PRODUCT_HUELLITAS, quantity: 1 }],
          [{ method: 'cash', amount_cents: 999 }],
        ),
      ).rejects.toThrow(/no existe o no está disponible/i)
      await client.query('rollback to savepoint s1')
      await expect(
        counterSale(
          client,
          [{ product_id: PRODUCT_COLLAR_INACTIVO, quantity: 1 }],
          [{ method: 'cash', amount_cents: 999 }],
        ),
      ).rejects.toThrow(/no existe o no está disponible/i)
    })
  })

  it('si el pago no alcanza, la existencia no se mueve', async () => {
    // Qué se rompería: piezas descontadas de una venta que nunca se pagó.
    await withTransaction(async (client) => {
      await seedStock(client, PRODUCT_SHAMPOO, 5)
      await setRole(client, 'authenticated', USER_RECEPCION)
      await client.query('savepoint s')
      await expect(
        counterSale(
          client,
          [{ product_id: PRODUCT_SHAMPOO, quantity: 2 }],
          [{ method: 'cash', amount_cents: 1 }],
        ),
      ).rejects.toThrow(/no cubre el total/i)
      await client.query('rollback to savepoint s')
      expect(await stockOf(client, PRODUCT_SHAMPOO)).toBe(5)
    })
  })
})

describe('cancelar una venta pagada', () => {
  it('devuelve exactamente las piezas vendidas, y solo una vez', async () => {
    // Qué se rompería: inventario que nunca se recupera, o que se devuelve de más.
    await withTransaction(async (client) => {
      await seedStock(client, PRODUCT_SHAMPOO, 5)
      const shampoo = await productPrice(client, PRODUCT_SHAMPOO)
      const total = sumLineItems([{ quantity: 2, ...shampoo }]).totalCents

      await setRole(client, 'authenticated', USER_RECEPCION)
      const saleId = await counterSale(
        client,
        [{ product_id: PRODUCT_SHAMPOO, quantity: 2 }],
        [{ method: 'cash', amount_cents: total }],
      )
      expect(await stockOf(client, PRODUCT_SHAMPOO)).toBe(3)

      await client.query("update sales set status = 'cancelled' where id = $1", [saleId])
      expect(await stockOf(client, PRODUCT_SHAMPOO)).toBe(5)

      // Cancelar de nuevo (ya cancelada) no vuelve a sumar.
      await client.query("update sales set status = 'cancelled' where id = $1", [saleId])
      expect(await stockOf(client, PRODUCT_SHAMPOO)).toBe(5)
    })
  })
})

describe('forma de pago con tarjeta (decisión #5)', () => {
  it('no deja registrar un pago con tarjeta sin elegir crédito o débito', async () => {
    // Qué se rompería: al facturar no se sabría la forma de pago y habría que
    // adivinarla; corregir una factura timbrada cuesta cancelar y reemplazar.
    await withTransaction(async (client) => {
      await seedStock(client, PRODUCT_SHAMPOO, 5)
      await setRole(client, 'authenticated', USER_RECEPCION)
      await expect(
        counterSale(
          client,
          [{ product_id: PRODUCT_SHAMPOO, quantity: 1 }],
          [{ method: 'card', amount_cents: 99999 }],
        ),
      ).rejects.toThrow(/crédito o de débito/i)
    })
  })

  it('guarda crédito (04) o débito (28) y deriva efectivo (01) y transferencia (03)', async () => {
    await withTransaction(async (client) => {
      await seedStock(client, PRODUCT_SHAMPOO, 5)
      const shampoo = await productPrice(client, PRODUCT_SHAMPOO)
      const total = sumLineItems([{ quantity: 1, ...shampoo }]).totalCents
      const third = Math.floor(total / 3)

      await setRole(client, 'authenticated', USER_RECEPCION)
      const saleId = await counterSale(
        client,
        [{ product_id: PRODUCT_SHAMPOO, quantity: 1 }],
        [
          { method: 'card', amount_cents: third, payment_form_code: '28' },
          { method: 'cash', amount_cents: third },
          { method: 'transfer_spei', amount_cents: total - 2 * third },
        ],
      )
      const { rows } = await client.query(
        'select method, payment_form_code from payments where sale_id = $1 order by method',
        [saleId],
      )
      // El orden de `order by method` es el del enum: cash, card, transfer_spei.
      expect(rows).toEqual([
        { method: 'cash', payment_form_code: '01' },
        { method: 'card', payment_form_code: '28' },
        { method: 'transfer_spei', payment_form_code: '03' },
      ])
    })
  })

  it('la tabla rechaza una tarjeta sin forma de pago aunque se salte el RPC', async () => {
    // Qué se rompería: un script o INSERT directo podría guardar el dato vacío.
    await withTransaction(async (client) => {
      await setRole(client, 'service_role')
      const { rows } = await client.query(
        `insert into sales (tenant_id, branch_id, customer_id, folio, status, paid_at)
         values ($1, $2, $3, 9999, 'paid', now()) returning id`,
        [TENANT_PATITAS, BRANCH_CENTRO, CUSTOMER_SOFIA],
      )
      await expect(
        client.query(
          `insert into payments (tenant_id, sale_id, method, amount_cents, status)
           values ($1, $2, 'card', 100, 'simulated_approved')`,
          [TENANT_PATITAS, rows[0].id],
        ),
      ).rejects.toThrow(/payments_card_needs_form_code/)
    })
  })
})
