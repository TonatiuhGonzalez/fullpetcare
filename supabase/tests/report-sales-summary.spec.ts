// Reporte de ventas (tarea 12.7, migración report_sales_summary.sql). Lo que se
// rompería en silencio:
//   - una venta nocturna que cae en el día equivocado (zona horaria),
//   - totales que no suman los tickets,
//   - las canceladas sumadas como ventas,
//   - que alguien sin permiso (o de otro negocio / otra sucursal) vea datos.
import { afterAll, describe, expect, it } from 'vitest'
import type { PoolClient } from 'pg'

import { closePool, setRole, withTransaction } from './helpers'
import {
  BRANCH_CENTRO,
  BRANCH_DEL_VALLE,
  CUSTOMER_SOFIA,
  TENANT_HUELLITAS,
  TENANT_PATITAS,
  USER_DUENO,
  USER_GROOMER,
  USER_RECEPCION,
} from './fixtures'

afterAll(closePool)

interface SeedSale {
  paidAt: string // instante UTC
  status?: 'paid' | 'cancelled' | 'open'
  subtotal?: number
  tax?: number
  discount?: number
  total: number
  payments?: { method: 'cash' | 'card' | 'transfer_spei'; amount: number }[]
  branch?: string
}

let folio = 8000
async function seedSale(client: PoolClient, sale: SeedSale): Promise<void> {
  await setRole(client, 'service_role')
  const status = sale.status ?? 'paid'
  const subtotal = sale.subtotal ?? Math.round(sale.total / 1.16)
  const tax = sale.tax ?? sale.total - subtotal
  const { rows } = await client.query(
    `insert into sales (tenant_id, branch_id, customer_id, folio, status, subtotal_cents, tax_cents, discount_cents, total_cents, paid_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning id`,
    [
      TENANT_PATITAS,
      sale.branch ?? BRANCH_CENTRO,
      CUSTOMER_SOFIA,
      folio++,
      status,
      subtotal,
      tax,
      sale.discount ?? 0,
      sale.total,
      sale.paidAt,
    ],
  )
  for (const p of sale.payments ?? [{ method: 'cash' as const, amount: sale.total }]) {
    await client.query(
      `insert into payments (tenant_id, sale_id, method, amount_cents, status, paid_at, payment_form_code)
       values ($1, $2, $3, $4, 'approved', $5, $6)`,
      [
        TENANT_PATITAS,
        rows[0].id,
        p.method,
        p.amount,
        sale.paidAt,
        { cash: '01', card: '04', transfer_spei: '03' }[p.method],
      ],
    )
  }
}

async function report(
  client: PoolClient,
  user: string,
  from: string,
  to: string,
  branch: string | null = null,
  tenant = TENANT_PATITAS,
) {
  await setRole(client, 'authenticated', user)
  const { rows } = await client.query(
    'select report_sales_summary($1, $2, $3, $4) as r',
    [tenant, from, to, branch],
  )
  return rows[0].r
}

// Tras un error Postgres deja la transacción abortada: SAVEPOINT para encadenar comprobaciones.
async function expectFails(
  client: PoolClient,
  action: () => Promise<unknown>,
  message: RegExp,
) {
  await client.query('savepoint expect_fails')
  let error: unknown = null
  try {
    await action()
  } catch (e) {
    error = e
  }
  await client.query('rollback to savepoint expect_fails')
  expect(error, 'debía fallar').not.toBeNull()
  expect((error as Error).message).toMatch(message)
}

describe('report_sales_summary: totales y desglose', () => {
  it('los totales coinciden al centavo con la suma de los tickets', async () => {
    // Si no sumaran igual, el dueño vería en el reporte un monto distinto al de
    // sus propios tickets, y dejaría de confiar en el sistema.
    await withTransaction(async (client) => {
      await seedSale(client, {
        paidAt: '2026-10-05T18:00:00Z',
        total: 11600,
        subtotal: 10000,
        tax: 1600,
      })
      await seedSale(client, {
        paidAt: '2026-10-05T19:00:00Z',
        total: 35000,
        subtotal: 30172,
        tax: 4828,
      })
      await seedSale(client, {
        paidAt: '2026-10-06T18:00:00Z',
        total: 101,
        subtotal: 87,
        tax: 14,
      })
      const r = await report(client, USER_DUENO, '2026-10-01', '2026-10-31')
      expect(r.totals).toEqual({
        sales_count: 3,
        subtotal_cents: 40259,
        iva_cents: 6442,
        discount_cents: 0,
        total_cents: 46701,
      })
      // Y el desglose por día suma lo mismo que el total.
      const byDaySum = r.by_day.reduce(
        (s: number, d: { total_cents: number }) => s + d.total_cents,
        0,
      )
      expect(byDaySum).toBe(46701)
    })
  })

  it('con descuento: subtotal + IVA − descuento = total (el total ya lo trae)', async () => {
    // El cobro no recalcula el IVA al descontar; el total es el dato exacto.
    await withTransaction(async (client) => {
      await seedSale(client, {
        paidAt: '2026-10-05T18:00:00Z',
        total: 35000,
        subtotal: 34483,
        tax: 5517,
        discount: 5000,
      })
      const r = await report(client, USER_DUENO, '2026-10-05', '2026-10-05')
      expect(r.totals.total_cents).toBe(35000)
      expect(r.totals.discount_cents).toBe(5000)
      expect(r.totals.subtotal_cents + r.totals.iva_cents - r.totals.discount_cents).toBe(
        r.totals.total_cents,
      )
    })
  })

  it('lista todos los días del periodo, también los sin ventas', async () => {
    // Para la gráfica: un día sin ventas debe verse en cero, no desaparecer.
    await withTransaction(async (client) => {
      await seedSale(client, { paidAt: '2026-10-05T18:00:00Z', total: 1000 })
      const r = await report(client, USER_DUENO, '2026-10-04', '2026-10-06')
      expect(
        r.by_day.map((d: { day: string; sales_count: number }) => [d.day, d.sales_count]),
      ).toEqual([
        ['2026-10-04', 0],
        ['2026-10-05', 1],
        ['2026-10-06', 0],
      ])
    })
  })

  it('un periodo sin ventas devuelve ceros, no error', async () => {
    await withTransaction(async (client) => {
      const r = await report(client, USER_DUENO, '2026-01-01', '2026-01-03')
      expect(r.totals.sales_count).toBe(0)
      expect(r.totals.total_cents).toBe(0)
      expect(r.by_method).toEqual({
        cash_cents: 0,
        card_cents: 0,
        transfer_cents: 0,
        openpay_cents: 0,
        change_given_cents: 0,
      })
      expect(r.by_day).toHaveLength(3)
    })
  })

  it('las canceladas no suman a los totales pero se cuentan aparte; las abiertas no cuentan', async () => {
    // Una venta cancelada ya no es dinero cobrado; sumarla inflaría las ventas.
    await withTransaction(async (client) => {
      await seedSale(client, { paidAt: '2026-10-05T18:00:00Z', total: 10000 })
      await seedSale(client, {
        paidAt: '2026-10-05T18:30:00Z',
        total: 25000,
        status: 'cancelled',
      })
      await seedSale(client, {
        paidAt: '2026-10-05T19:00:00Z',
        total: 99900,
        status: 'open',
      })
      const r = await report(client, USER_DUENO, '2026-10-05', '2026-10-05')
      expect(r.totals.total_cents).toBe(10000)
      expect(r.totals.sales_count).toBe(1)
      expect(r.cancelled).toEqual({ sales_count: 1, total_cents: 25000 })
    })
  })

  it('el cobrado por método descuenta el cambio y respeta los pagos mixtos', async () => {
    // $500 en efectivo por $350 (cambio $150) + mixto $200 efectivo/$300 tarjeta por $450
    // (cambio $50): el efectivo que quedó es $350 + $150 y la tarjeta $300.
    await withTransaction(async (client) => {
      await seedSale(client, {
        paidAt: '2026-10-05T18:00:00Z',
        total: 35000,
        payments: [{ method: 'cash', amount: 50000 }],
      })
      await seedSale(client, {
        paidAt: '2026-10-05T19:00:00Z',
        total: 45000,
        payments: [
          { method: 'cash', amount: 20000 },
          { method: 'card', amount: 30000 },
        ],
      })
      await seedSale(client, {
        paidAt: '2026-10-05T20:00:00Z',
        total: 10000,
        payments: [{ method: 'transfer_spei', amount: 10000 }],
      })
      const r = await report(client, USER_DUENO, '2026-10-05', '2026-10-05')
      expect(r.by_method).toEqual({
        cash_cents: 35000 + 15000,
        card_cents: 30000,
        transfer_cents: 10000,
        openpay_cents: 0,
        change_given_cents: 15000 + 5000,
      })
    })
  })

  it('desglosa por sucursal, incluida la que no tuvo ventas', async () => {
    await withTransaction(async (client) => {
      await seedSale(client, {
        paidAt: '2026-10-05T18:00:00Z',
        total: 10000,
        branch: BRANCH_CENTRO,
      })
      await seedSale(client, {
        paidAt: '2026-10-05T18:00:00Z',
        total: 5000,
        branch: BRANCH_CENTRO,
      })
      const r = await report(client, USER_DUENO, '2026-10-05', '2026-10-05')
      const byName = Object.fromEntries(
        r.by_branch.map(
          (b: { branch_name: string; total_cents: number; sales_count: number }) => [
            b.branch_name,
            [b.sales_count, b.total_cents],
          ],
        ),
      )
      expect(byName).toEqual({
        'Sucursal Centro': [2, 15000],
        'Sucursal Del Valle': [0, 0],
      })
    })
  })
})

describe('report_sales_summary: zona horaria y bordes de periodo', () => {
  it('una venta a las 11 pm cuenta en SU día local aunque en UTC ya sea el siguiente', async () => {
    // Centro es de la CDMX (UTC−6): 2026-10-06T05:30Z son las 23:30 del día 5.
    // Si el reporte usara UTC, esa venta caería en el día 6.
    await withTransaction(async (client) => {
      await seedSale(client, { paidAt: '2026-10-06T05:30:00Z', total: 1000 })
      const r = await report(client, USER_DUENO, '2026-10-05', '2026-10-05')
      expect(r.totals.sales_count).toBe(1)
      const r2 = await report(client, USER_DUENO, '2026-10-06', '2026-10-06')
      expect(r2.totals.sales_count).toBe(0)
    })
  })

  it('la zona es la de CADA sucursal: la misma hora cae en días distintos en CDMX y Tijuana', async () => {
    // 2026-10-06T06:30Z: en Tijuana (UTC−7, horario de verano) son las 23:30 del
    // día 5; en CDMX (UTC−6) ya es la 00:30 del día 6.
    await withTransaction(async (client) => {
      await setRole(client, 'service_role')
      await client.query(
        `update branches set timezone = 'America/Tijuana' where id = $1`,
        [BRANCH_DEL_VALLE],
      )
      await seedSale(client, {
        paidAt: '2026-10-06T06:30:00Z',
        total: 1000,
        branch: BRANCH_CENTRO,
      })
      await seedSale(client, {
        paidAt: '2026-10-06T06:30:00Z',
        total: 2000,
        branch: BRANCH_DEL_VALLE,
      })
      const day5 = await report(client, USER_DUENO, '2026-10-05', '2026-10-05')
      const day6 = await report(client, USER_DUENO, '2026-10-06', '2026-10-06')
      expect(day5.totals.total_cents).toBe(2000) // la de Tijuana
      expect(day6.totals.total_cents).toBe(1000) // la de CDMX
    })
  })

  it('cambio de mes: una venta de las 11:59 pm del 30 es de septiembre', async () => {
    // 2026-10-01T05:59Z = 23:59 del 30 de septiembre en la CDMX.
    await withTransaction(async (client) => {
      await seedSale(client, { paidAt: '2026-10-01T05:59:00Z', total: 1000 })
      await seedSale(client, { paidAt: '2026-10-01T06:00:00Z', total: 4000 }) // 00:00 del 1 de octubre
      expect(
        (await report(client, USER_DUENO, '2026-09-01', '2026-09-30')).totals.total_cents,
      ).toBe(1000)
      expect(
        (await report(client, USER_DUENO, '2026-10-01', '2026-10-31')).totals.total_cents,
      ).toBe(4000)
    })
  })

  it('rechaza un periodo invertido o de más de un año', async () => {
    await withTransaction(async (client) => {
      await expectFails(
        client,
        () => report(client, USER_DUENO, '2026-10-10', '2026-10-01'),
        /periodo no es válido/i,
      )
      await expectFails(
        client,
        () => report(client, USER_DUENO, '2024-01-01', '2026-01-01'),
        /mayor a un año/i,
      )
    })
  })
})

describe('report_sales_summary: permisos y aislamiento', () => {
  it('recepción y groomer no tienen el permiso reports por defecto', async () => {
    await withTransaction(async (client) => {
      await expectFails(
        client,
        () => report(client, USER_RECEPCION, '2026-10-01', '2026-10-31'),
        /no tienes permiso/i,
      )
      await expectFails(
        client,
        () => report(client, USER_GROOMER, '2026-10-01', '2026-10-31'),
        /no tienes permiso/i,
      )
    })
  })

  it('con el permiso concedido, recepción solo ve SU sucursal', async () => {
    // Dar el permiso es una fila de role_permissions (D13); aun así no debe ver
    // las ventas de la sucursal que no tiene asignada.
    await withTransaction(async (client) => {
      await setRole(client, 'service_role')
      await client.query(
        `update role_permissions set can_view = true where tenant_id = $1 and role = 'receptionist' and module = 'reports'`,
        [TENANT_PATITAS],
      )
      await seedSale(client, {
        paidAt: '2026-10-05T18:00:00Z',
        total: 10000,
        branch: BRANCH_CENTRO,
      })
      await seedSale(client, {
        paidAt: '2026-10-05T18:00:00Z',
        total: 77000,
        branch: BRANCH_DEL_VALLE,
      })
      const r = await report(client, USER_RECEPCION, '2026-10-05', '2026-10-05')
      expect(r.totals.total_cents).toBe(10000)
      expect(r.by_branch).toHaveLength(1)
      await expectFails(
        client,
        () =>
          report(client, USER_RECEPCION, '2026-10-05', '2026-10-05', BRANCH_DEL_VALLE),
        /no tienes permiso/i,
      )
    })
  })

  it('el dueño puede filtrar por una sucursal', async () => {
    await withTransaction(async (client) => {
      await seedSale(client, {
        paidAt: '2026-10-05T18:00:00Z',
        total: 10000,
        branch: BRANCH_CENTRO,
      })
      await seedSale(client, {
        paidAt: '2026-10-05T18:00:00Z',
        total: 77000,
        branch: BRANCH_DEL_VALLE,
      })
      const r = await report(
        client,
        USER_DUENO,
        '2026-10-05',
        '2026-10-05',
        BRANCH_DEL_VALLE,
      )
      expect(r.totals.total_cents).toBe(77000)
    })
  })

  it('un negocio nunca ve los datos de otro, ni pidiendo su id', async () => {
    // El dueño de Patitas pide el reporte de Huellitas Spa.
    await withTransaction(async (client) => {
      await seedSale(client, { paidAt: '2026-10-05T18:00:00Z', total: 10000 })
      await expectFails(
        client,
        () =>
          report(client, USER_DUENO, '2026-10-05', '2026-10-05', null, TENANT_HUELLITAS),
        /no tienes permiso/i,
      )
    })
  })

  it('anon no puede ejecutarla', async () => {
    await withTransaction(async (client) => {
      await setRole(client, 'anon')
      await expectFails(
        client,
        () =>
          client.query('select report_sales_summary($1, $2, $3)', [
            TENANT_PATITAS,
            '2026-10-01',
            '2026-10-02',
          ]),
        /permission denied/i,
      )
    })
  })
})
