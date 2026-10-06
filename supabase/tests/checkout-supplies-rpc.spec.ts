// Prueba que los insumos cobrables de la consulta pasan al ticket (fase 11,
// tarea 11.14 / HMH Four #2043): checkout_appointment() los convierte en partidas
// SIN crear otro movimiento de stock, los de uso interno no aparecen, una línea se
// cobra una sola vez, y cancelar la venta no devuelve lo que ya se aplicó.
//
// Cobra el dueño: recepción solo ve Centro y esta consulta es de Del Valle.
// Mismo patrón que checkout-products-rpc.spec.ts: sesión simulada con pg dentro de
// una transacción que siempre se revierte.
import { afterAll, describe, expect, it } from 'vitest'
import type { PoolClient } from 'pg'

import { sumLineItems } from '@/lib/money'

import { closePool, setRole, tryQuery, withTransaction } from './helpers'
import {
  BRANCH_DEL_VALLE,
  CUSTOMER_SOFIA,
  PET_ROCKY,
  PRODUCT_ALIMENTO,
  PRODUCT_SHAMPOO,
  SERVICE_CONSULTA_GENERAL,
  TENANT_PATITAS,
  USER_DUENO,
  USER_VET,
} from './fixtures'

afterAll(closePool)

async function seedStock(client: PoolClient, productId: string, quantity: number) {
  await setRole(client, 'service_role')
  await client.query(
    `insert into stock_movements (tenant_id, branch_id, product_id, created_by, movement_type, quantity)
     values ($1, $2, $3, $4, 'purchase', $5)`,
    [TENANT_PATITAS, BRANCH_DEL_VALLE, productId, USER_DUENO, quantity],
  )
}

async function stockOf(client: PoolClient, productId: string): Promise<number> {
  await setRole(client, 'service_role')
  const { rows } = await client.query(
    'select coalesce(sum(quantity), 0)::int as stock from stock_movements where product_id = $1 and branch_id = $2',
    [productId, BRANCH_DEL_VALLE],
  )
  return rows[0].stock
}

async function priceOf(client: PoolClient, table: 'products' | 'services', id: string) {
  await setRole(client, 'service_role')
  const { rows } = await client.query(
    `select price_cents, tax_rate_bp from ${table} where id = $1`,
    [id],
  )
  return {
    unitPriceCents: rows[0].price_cents as number,
    taxRateBp: rows[0].tax_rate_bp as number,
  }
}

/**
 * Cita veterinaria en Del Valle con una consulta general, ya atendida. El vet
 * registra los insumos MIENTRAS atiende (la cita está 'in_progress'), y recién
 * después se marca 'completed', igual que en la operación real.
 */
async function seedConsultation(
  client: PoolClient,
  supplies: Array<{ productId: string; quantity: number; billable: boolean }>,
): Promise<string> {
  await setRole(client, 'service_role')
  const { rows } = await client.query(
    `insert into appointments (tenant_id, branch_id, customer_id, pet_id, kind, employee_user_id, starts_at, ends_at, status, created_by)
     values ($1, $2, $3, $4, 'veterinary', $5, now() + interval '30 days', now() + interval '30 days' + interval '30 minutes', 'in_progress', $5)
     returning id`,
    [TENANT_PATITAS, BRANCH_DEL_VALLE, CUSTOMER_SOFIA, PET_ROCKY, USER_VET],
  )
  const appointmentId: string = rows[0].id
  await client.query(
    `insert into appointment_services (tenant_id, appointment_id, service_id, name_snapshot, unit_price_cents, quantity, duration_minutes_snapshot)
     select $1, $2, id, name, price_cents, 1, duration_minutes from services where id = $3`,
    [TENANT_PATITAS, appointmentId, SERVICE_CONSULTA_GENERAL],
  )

  await setRole(client, 'authenticated', USER_VET)
  for (const s of supplies) {
    await client.query('select add_appointment_product($1, $2, $3, $4)', [
      appointmentId,
      s.productId,
      s.quantity,
      s.billable,
    ])
  }

  await setRole(client, 'service_role')
  await client.query("update appointments set status = 'completed' where id = $1", [
    appointmentId,
  ])
  return appointmentId
}

async function checkout(
  client: PoolClient,
  appointmentId: string,
  totalCents: number,
): Promise<string> {
  const { rows } = await client.query(
    'select checkout_appointment($1, $2::jsonb) as sale_id',
    [appointmentId, JSON.stringify([{ method: 'cash', amount_cents: totalCents }])],
  )
  return rows[0].sale_id
}

describe('insumos cobrables de la consulta en el ticket', () => {
  it('servicio + insumo cobrable + producto de mostrador cuadran al centavo', async () => {
    // Qué prueba: las tres fuentes de partidas se desglosan por partida y se suman.
    // Qué se rompería: el cliente paga un total distinto al que muestra el ticket.
    await withTransaction(async (client) => {
      await seedStock(client, PRODUCT_SHAMPOO, 10)
      await seedStock(client, PRODUCT_ALIMENTO, 10)
      const appointmentId = await seedConsultation(client, [
        { productId: PRODUCT_SHAMPOO, quantity: 2, billable: true },
      ])
      const consultation = await priceOf(client, 'services', SERVICE_CONSULTA_GENERAL)
      const shampoo = await priceOf(client, 'products', PRODUCT_SHAMPOO)
      const food = await priceOf(client, 'products', PRODUCT_ALIMENTO)
      const expected = sumLineItems([
        { quantity: 1, ...consultation },
        { quantity: 2, ...shampoo },
        { quantity: 1, ...food },
      ])

      await setRole(client, 'authenticated', USER_DUENO)
      const { rows: saleRows } = await client.query(
        'select checkout_appointment($1, $2::jsonb, 0, $3::jsonb) as sale_id',
        [
          appointmentId,
          JSON.stringify([{ method: 'cash', amount_cents: expected.totalCents }]),
          JSON.stringify([{ product_id: PRODUCT_ALIMENTO, quantity: 1 }]),
        ],
      )
      const { rows } = await client.query(
        'select subtotal_cents, tax_cents, total_cents from sales where id = $1',
        [saleRows[0].sale_id],
      )
      expect(rows[0]).toMatchObject({
        subtotal_cents: expected.subtotalCents,
        tax_cents: expected.taxCents,
        total_cents: expected.totalCents,
      })
      const { rows: items } = await client.query(
        'select count(*)::int as n, count(appointment_product_id)::int as from_consultation from sale_items where sale_id = $1',
        [saleRows[0].sale_id],
      )
      expect(items[0]).toEqual({ n: 3, from_consultation: 1 })
    })
  })

  it('las líneas de uso interno no aparecen en el ticket', async () => {
    // Qué se rompería: cobrarle al cliente los guantes y las gasas.
    await withTransaction(async (client) => {
      await seedStock(client, PRODUCT_SHAMPOO, 10)
      const appointmentId = await seedConsultation(client, [
        { productId: PRODUCT_SHAMPOO, quantity: 3, billable: false },
      ])
      const consultation = await priceOf(client, 'services', SERVICE_CONSULTA_GENERAL)
      const total = sumLineItems([{ quantity: 1, ...consultation }]).totalCents

      await setRole(client, 'authenticated', USER_DUENO)
      const saleId = await checkout(client, appointmentId, total)
      const { rows } = await client.query(
        "select count(*)::int as n from sale_items where sale_id = $1 and item_type = 'product'",
        [saleId],
      )
      expect(rows[0].n).toBe(0)
    })
  })

  it('cobrar no crea otro movimiento de stock, y cancelar la venta no devuelve el consumo', async () => {
    // Qué se rompería: la pieza se descontaría dos veces al cobrar, o el
    // medicamento ya aplicado "regresaría" al inventario al cancelar el cobro.
    await withTransaction(async (client) => {
      await seedStock(client, PRODUCT_SHAMPOO, 10)
      const appointmentId = await seedConsultation(client, [
        { productId: PRODUCT_SHAMPOO, quantity: 2, billable: true },
      ])
      expect(await stockOf(client, PRODUCT_SHAMPOO)).toBe(8)
      const consultation = await priceOf(client, 'services', SERVICE_CONSULTA_GENERAL)
      const shampoo = await priceOf(client, 'products', PRODUCT_SHAMPOO)
      const total = sumLineItems([
        { quantity: 1, ...consultation },
        { quantity: 2, ...shampoo },
      ]).totalCents

      await setRole(client, 'authenticated', USER_DUENO)
      const saleId = await checkout(client, appointmentId, total)
      expect(await stockOf(client, PRODUCT_SHAMPOO)).toBe(8)

      await setRole(client, 'authenticated', USER_DUENO)
      await client.query("update sales set status = 'cancelled' where id = $1", [saleId])
      expect(await stockOf(client, PRODUCT_SHAMPOO)).toBe(8)
    })
  })

  it('tras cancelar la venta, la cita se puede volver a cobrar con sus insumos', async () => {
    // Qué se rompería: una cancelación dejaría los insumos imposibles de cobrar.
    await withTransaction(async (client) => {
      await seedStock(client, PRODUCT_SHAMPOO, 10)
      const appointmentId = await seedConsultation(client, [
        { productId: PRODUCT_SHAMPOO, quantity: 1, billable: true },
      ])
      const consultation = await priceOf(client, 'services', SERVICE_CONSULTA_GENERAL)
      const shampoo = await priceOf(client, 'products', PRODUCT_SHAMPOO)
      const total = sumLineItems([
        { quantity: 1, ...consultation },
        { quantity: 1, ...shampoo },
      ]).totalCents

      await setRole(client, 'authenticated', USER_DUENO)
      const first = await checkout(client, appointmentId, total)
      await client.query("update sales set status = 'cancelled' where id = $1", [first])
      const second = await checkout(client, appointmentId, total)
      expect(second).not.toBe(first)
    })
  })
})

describe('una línea se cobra una sola vez (garantía en la base)', () => {
  it('rechaza una segunda partida de la misma línea mientras la primera venta siga vigente', async () => {
    // Qué se rompería: un script o un cobro simultáneo cobraría el mismo
    // medicamento dos veces, aunque la pantalla lo impidiera.
    await withTransaction(async (client) => {
      await seedStock(client, PRODUCT_SHAMPOO, 10)
      const appointmentId = await seedConsultation(client, [
        { productId: PRODUCT_SHAMPOO, quantity: 1, billable: true },
      ])
      const consultation = await priceOf(client, 'services', SERVICE_CONSULTA_GENERAL)
      const shampoo = await priceOf(client, 'products', PRODUCT_SHAMPOO)
      const total = sumLineItems([
        { quantity: 1, ...consultation },
        { quantity: 1, ...shampoo },
      ]).totalCents
      await setRole(client, 'authenticated', USER_DUENO)
      const saleId = await checkout(client, appointmentId, total)

      await setRole(client, 'service_role')
      const { rows } = await client.query(
        'select appointment_product_id from sale_items where sale_id = $1 and appointment_product_id is not null',
        [saleId],
      )
      const error = await tryQuery(
        client,
        `insert into sale_items (tenant_id, sale_id, item_type, product_id, appointment_id, appointment_product_id, description, quantity, unit_price_cents, tax_rate_bp, tax_cents, line_total_cents)
         values ($1, $2, 'product', $3, $4, $5, 'duplicado', 1, 100, 1600, 14, 100)`,
        [
          TENANT_PATITAS,
          saleId,
          PRODUCT_SHAMPOO,
          appointmentId,
          rows[0].appointment_product_id,
        ],
      )
      expect(error).toMatch(/ya se cobró en otra venta/i)
    })
  })

  it('rechaza una línea que no es de la cita de la partida', async () => {
    // Qué se rompería: cobrar en la cita A un insumo registrado en la cita B.
    await withTransaction(async (client) => {
      await seedStock(client, PRODUCT_SHAMPOO, 10)
      const other = await seedConsultation(client, [
        { productId: PRODUCT_SHAMPOO, quantity: 1, billable: true },
      ])
      const mine = await seedConsultation(client, [])
      const consultation = await priceOf(client, 'services', SERVICE_CONSULTA_GENERAL)
      const total = sumLineItems([{ quantity: 1, ...consultation }]).totalCents
      await setRole(client, 'authenticated', USER_DUENO)
      const saleId = await checkout(client, mine, total)

      await setRole(client, 'service_role')
      const { rows } = await client.query(
        'select id from appointment_products where appointment_id = $1',
        [other],
      )
      const error = await tryQuery(
        client,
        `insert into sale_items (tenant_id, sale_id, item_type, product_id, appointment_id, appointment_product_id, description, quantity, unit_price_cents, tax_rate_bp, tax_cents, line_total_cents)
         values ($1, $2, 'product', $3, $4, $5, 'ajeno', 1, 100, 1600, 14, 100)`,
        [TENANT_PATITAS, saleId, PRODUCT_SHAMPOO, mine, rows[0].id],
      )
      expect(error).toMatch(/no corresponde a esta cita/i)
    })
  })
})
