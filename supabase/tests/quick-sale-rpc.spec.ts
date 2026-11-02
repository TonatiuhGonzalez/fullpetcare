// Cobro rápido (fase 30, PLAN.md D30 punto 6; migración 20261025120000_quick_sale.sql):
// checkout_quick_sale() y los dos reportes que lo ven.
//
// Qué se protege: que un servicio se pueda cobrar sin cita ni cliente, que la venta quede como
// cualquier otra (pagos, existencia, reportes) con su quién atendió y su grupo de especie, y
// que nada se guarde a medias si algo falla.
import type { PoolClient } from 'pg'
import { afterAll, describe, expect, it } from 'vitest'

import { closePool, setRole, withTransaction } from './helpers'
import {
  BRANCH_CENTRO,
  PRODUCT_ALIMENTO,
  SERVICE_BANO,
  TENANT_HUELLITAS,
  TENANT_PATITAS,
  USER_DUENO,
  USER_GROOMER,
  USER_RECEPCION,
  USER_VET,
} from './fixtures'

afterAll(closePool)

const CASH = [{ method: 'cash', amount_cents: 500000 }]

async function groupId(client: PoolClient, name: string, tenant = TENANT_PATITAS) {
  await setRole(client, 'service_role')
  const { rows } = await client.query(
    'select id from species_groups where tenant_id = $1 and name = $2 and deleted_at is null',
    [tenant, name],
  )
  return rows[0].id as string
}

async function quickSale(
  client: PoolClient,
  user: string,
  {
    services = [{ service_id: SERVICE_BANO, quantity: 1 }] as unknown[],
    products = [] as unknown[],
    payments = CASH as unknown[],
    attendedBy = null as string | null,
    group = null as string | null,
  } = {},
) {
  await setRole(client, 'authenticated', user)
  const { rows } = await client.query(
    'select checkout_quick_sale($1, $2::jsonb, $3::jsonb, $4::jsonb, 0, $5, $6) as id',
    [
      BRANCH_CENTRO,
      JSON.stringify(services),
      JSON.stringify(products),
      JSON.stringify(payments),
      attendedBy,
      group,
    ],
  )
  return rows[0].id as string
}

async function seedStock(client: PoolClient, productId: string, quantity: number) {
  await setRole(client, 'service_role')
  await client.query(
    `insert into stock_movements (tenant_id, branch_id, product_id, created_by, movement_type, quantity)
     values ($1, $2, $3, $4, 'purchase', $5)`,
    [TENANT_PATITAS, BRANCH_CENTRO, productId, USER_DUENO, quantity],
  )
}

describe('checkout_quick_sale()', () => {
  // Qué prueba: el caso del veterinario: un servicio sin cita ni cliente, con quién atendió y
  // el grupo de especie, pagado en efectivo.
  // Qué se rompería: habría que registrar cliente y mascota para cobrar un servicio de un minuto.
  it('cobra un servicio sin cita y sin cliente, con quién atendió y la especie', async () => {
    await withTransaction(async (client) => {
      const perros = await groupId(client, 'Perros')
      const id = await quickSale(client, USER_RECEPCION, {
        attendedBy: USER_GROOMER,
        group: perros,
      })

      await setRole(client, 'service_role')
      const sale = await client.query(
        `select customer_id, status, attended_by_user_id, species_group_id, closed_by, total_cents,
                (select count(*)::int from payments where sale_id = sales.id) as payments
           from sales where id = $1`,
        [id],
      )
      expect(sale.rows[0]).toMatchObject({
        customer_id: null,
        status: 'paid',
        attended_by_user_id: USER_GROOMER,
        species_group_id: perros,
        closed_by: USER_RECEPCION,
        payments: 1,
      })
      expect(sale.rows[0].total_cents).toBeGreaterThan(0)

      const items = await client.query(
        'select item_type, appointment_id, description from sale_items where sale_id = $1',
        [id],
      )
      expect(items.rows).toHaveLength(1)
      expect(items.rows[0]).toMatchObject({ item_type: 'service', appointment_id: null })
    })
  })

  // Qué prueba: servicio y producto en el mismo ticket; la existencia baja y el total suma
  // ambas partidas con su IVA por partida.
  it('un servicio y un producto en el mismo ticket', async () => {
    await withTransaction(async (client) => {
      await seedStock(client, PRODUCT_ALIMENTO, 4)
      const id = await quickSale(client, USER_DUENO, {
        products: [{ product_id: PRODUCT_ALIMENTO, quantity: 2 }],
      })
      await setRole(client, 'service_role')
      const items = await client.query(
        'select item_type, line_total_cents from sale_items where sale_id = $1 order by item_type',
        [id],
      )
      expect(items.rows.map((r) => r.item_type)).toEqual(['service', 'product'])
      const sale = await client.query('select total_cents from sales where id = $1', [id])
      expect(sale.rows[0].total_cents).toBe(
        items.rows.reduce((s, r) => s + r.line_total_cents, 0),
      )
      const stock = await client.query(
        'select coalesce(sum(quantity), 0)::int as n from stock_movements where product_id = $1 and branch_id = $2',
        [PRODUCT_ALIMENTO, BRANCH_CENTRO],
      )
      expect(stock.rows[0].n).toBe(2)
    })
  })

  // Qué prueba: sin servicios ni productos no hay nada que cobrar.
  it('rechaza un cobro sin servicios ni productos', async () => {
    await withTransaction(async (client) => {
      await client.query('savepoint s')
      await expect(quickSale(client, USER_DUENO, { services: [] })).rejects.toThrow(
        /al menos un servicio o un producto/i,
      )
      await client.query('rollback to savepoint s')
    })
  })

  // Qué prueba: groomer y veterinario no cobran (igual que la venta de mostrador).
  it('solo dueño y recepción cobran', async () => {
    await withTransaction(async (client) => {
      for (const user of [USER_GROOMER, USER_VET]) {
        await client.query('savepoint s')
        await expect(quickSale(client, user)).rejects.toThrow(/permiso para cobrar|acceso a esta sucursal/i)
        await client.query('rollback to savepoint s')
      }
    })
  })

  // Qué prueba: no se puede atribuir la venta a alguien de otro negocio ni usar el grupo de
  // especie de otro negocio (la función salta RLS).
  it('rechaza quien atendió o el grupo de especie de otro negocio', async () => {
    await withTransaction(async (client) => {
      const ajeno = await groupId(client, 'Perros', TENANT_HUELLITAS)
      await client.query('savepoint s')
      await expect(quickSale(client, USER_DUENO, { group: ajeno })).rejects.toThrow(
        /grupo de especie no existe/i,
      )
      await client.query('rollback to savepoint s')

      await client.query('savepoint s')
      await expect(
        quickSale(client, USER_DUENO, {
          attendedBy: '99999999-9999-4999-8999-999999999999',
        }),
      ).rejects.toThrow(/no pertenece a este negocio/i)
      await client.query('rollback to savepoint s')
    })
  })

  // Qué prueba: si el pago no alcanza, no queda venta ni partidas (todo o nada).
  it('un pago insuficiente no deja nada guardado', async () => {
    await withTransaction(async (client) => {
      await setRole(client, 'service_role')
      const before = await client.query('select count(*)::int as n from sales')
      await client.query('savepoint s')
      await expect(
        quickSale(client, USER_DUENO, {
          payments: [{ method: 'cash', amount_cents: 1 }],
        }),
      ).rejects.toThrow(/no cubre el total/i)
      await client.query('rollback to savepoint s')
      await setRole(client, 'service_role')
      const after = await client.query('select count(*)::int as n from sales')
      expect(after.rows[0].n).toBe(before.rows[0].n)
    })
  })

  // Qué prueba: el servicio del cobro rápido se atribuye a quien atendió en el reporte por
  // empleado, no a quien cobró.
  it('el reporte por empleado atribuye el servicio a quien atendió', async () => {
    await withTransaction(async (client) => {
      await quickSale(client, USER_RECEPCION, { attendedBy: USER_GROOMER })
      await setRole(client, 'authenticated', USER_DUENO)
      const { rows } = await client.query(
        'select report_staff_activity($1, current_date - 1, current_date + 1) as r',
        [TENANT_PATITAS],
      )
      const staff = rows[0].r as Array<{ user_id: string | null; services_cents: number }>
      const groomer = staff.find((s) => s.user_id === USER_GROOMER)
      expect(groomer?.services_cents).toBeGreaterThan(0)
      expect(staff.find((s) => s.user_id === USER_RECEPCION)?.services_cents ?? 0).toBe(0)
    })
  })

  // Qué prueba: el reporte por grupo de especie cuenta la venta en su grupo y deja el resto
  // como "Sin dato".
  it('el reporte por grupo de especie cuenta la venta en su grupo', async () => {
    await withTransaction(async (client) => {
      const aves = await groupId(client, 'Aves')
      await quickSale(client, USER_DUENO, { group: aves })
      await quickSale(client, USER_DUENO)
      await setRole(client, 'authenticated', USER_DUENO)
      const { rows } = await client.query(
        'select report_sales_by_species_group($1, current_date - 1, current_date + 1) as r',
        [TENANT_PATITAS],
      )
      const groups = rows[0].r as Array<{ name: string; sales_count: number }>
      expect(groups.find((g) => g.name === 'Aves')?.sales_count).toBe(1)
      expect(
        groups.find((g) => g.name === 'Sin dato')?.sales_count,
      ).toBeGreaterThanOrEqual(1)
    })
  })
})
