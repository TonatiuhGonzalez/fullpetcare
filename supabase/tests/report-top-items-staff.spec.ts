// Reportes de lo más vendido y de actividad por empleado (tareas 12.8 y 12.9,
// migración report_top_items_and_staff.sql). Lo que se rompería en silencio:
//   - una venta cancelada contada como vendida,
//   - un producto vendido con un servicio atribuido al empleado equivocado,
//   - que lo "sin empleado" desaparezca del reporte en vez de verse,
//   - que alguien sin permiso (o de otro negocio / sucursal) vea datos.
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
  SERVICE_BANO,
  SERVICE_CORTE_RAZA,
  TENANT_HUELLITAS,
  TENANT_PATITAS,
  USER_DUENO,
  USER_GROOMER,
  USER_RECEPCION,
  USER_VET,
} from './fixtures'

afterAll(closePool)

const PAID_AT = '2026-10-05T18:00:00Z' // 12:00 en CDMX, día 5

interface Item {
  type: 'service' | 'product'
  id: string
  description: string
  quantity?: number
  unit: number
  appointmentId?: string
}

let folio = 9000
async function seedSale(
  client: PoolClient,
  items: Item[],
  opts: {
    status?: 'paid' | 'cancelled' | 'open'
    closedBy?: string | null
    branch?: string
    paidAt?: string
    discount?: number
  } = {},
): Promise<string> {
  await setRole(client, 'service_role')
  const total =
    items.reduce((s, i) => s + i.unit * (i.quantity ?? 1), 0) - (opts.discount ?? 0)
  const { rows } = await client.query(
    `insert into sales (tenant_id, branch_id, customer_id, folio, status, subtotal_cents, tax_cents, discount_cents, total_cents, paid_at, closed_by)
     values ($1, $2, $3, $4, $5, $6, 0, $7, $6, $8, $9) returning id`,
    [
      TENANT_PATITAS,
      opts.branch ?? BRANCH_CENTRO,
      CUSTOMER_SOFIA,
      folio++,
      opts.status ?? 'paid',
      total,
      opts.discount ?? 0,
      opts.paidAt ?? PAID_AT,
      opts.closedBy === undefined ? USER_RECEPCION : opts.closedBy,
    ],
  )
  for (const it of items) {
    const qty = it.quantity ?? 1
    const line = it.unit * qty
    const tax = line - Math.round(line / 1.16)
    await client.query(
      `insert into sale_items (tenant_id, sale_id, item_type, service_id, product_id, appointment_id, description, quantity, unit_price_cents, tax_rate_bp, tax_cents, line_total_cents)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 1600, $10, $11)`,
      [
        TENANT_PATITAS,
        rows[0].id,
        it.type,
        it.type === 'service' ? it.id : null,
        it.type === 'product' ? it.id : null,
        it.appointmentId ?? null,
        it.description,
        qty,
        it.unit,
        tax,
        line,
      ],
    )
  }
  return rows[0].id
}

async function seedAppointment(
  client: PoolClient,
  employee: string | null,
  opts: { status?: string; startsAt?: string; branch?: string; kind?: string } = {},
): Promise<string> {
  await setRole(client, 'service_role')
  const startsAt = opts.startsAt ?? '2026-10-05T17:00:00Z'
  const { rows } = await client.query(
    `insert into appointments (tenant_id, branch_id, customer_id, pet_id, kind, employee_user_id, starts_at, ends_at, status, created_by)
     values ($1, $2, $3, $4, $5, $6, $7::timestamptz, $7::timestamptz + interval '60 minutes', $8, $9) returning id`,
    [
      TENANT_PATITAS,
      opts.branch ?? BRANCH_CENTRO,
      CUSTOMER_SOFIA,
      PET_ROCKY,
      opts.kind ?? 'grooming',
      employee,
      startsAt,
      opts.status ?? 'completed',
      USER_DUENO,
    ],
  )
  return rows[0].id
}

async function call<T = unknown>(
  client: PoolClient,
  fn: string,
  user: string,
  args: unknown[],
): Promise<T> {
  await setRole(client, 'authenticated', user)
  const placeholders = args.map((_, i) => `$${i + 1}`).join(', ')
  const { rows } = await client.query(`select ${fn}(${placeholders}) as r`, args)
  return rows[0].r
}
const topItems = (
  c: PoolClient,
  user: string,
  from = '2026-10-01',
  to = '2026-10-31',
  branch: string | null = null,
  limit = 20,
  tenant = TENANT_PATITAS,
) => call(c, 'report_top_items', user, [tenant, from, to, branch, limit])
const staff = (
  c: PoolClient,
  user: string,
  from = '2026-10-01',
  to = '2026-10-31',
  branch: string | null = null,
  tenant = TENANT_PATITAS,
) => call(c, 'report_staff_activity', user, [tenant, from, to, branch])

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

const bano = (over: Partial<Item> = {}): Item => ({
  type: 'service',
  id: SERVICE_BANO,
  description: 'Baño',
  unit: 25000,
  ...over,
})
const corte = (over: Partial<Item> = {}): Item => ({
  type: 'service',
  id: SERVICE_CORTE_RAZA,
  description: 'Corte de raza',
  unit: 40000,
  ...over,
})
const alimento = (over: Partial<Item> = {}): Item => ({
  type: 'product',
  id: PRODUCT_ALIMENTO,
  description: 'Alimento seco adulto 3 kg',
  unit: 38900,
  ...over,
})
const shampoo = (over: Partial<Item> = {}): Item => ({
  type: 'product',
  id: PRODUCT_SHAMPOO,
  description: 'Shampoo hipoalergénico 250 ml',
  unit: 14500,
  ...over,
})

describe('report_top_items', () => {
  it('suma cantidad e importe por servicio y producto, y los ordena por cantidad', async () => {
    // Si agrupara mal, el "más vendido" no sería el que de verdad más se vende.
    await withTransaction(async (client) => {
      await seedSale(client, [bano(), shampoo({ quantity: 2 })])
      await seedSale(client, [bano({ quantity: 2 }), corte()])
      await seedSale(client, [alimento()])
      const r = await topItems(client, USER_DUENO)
      expect(
        r.services.map((s: { name: string; quantity: number; revenue_cents: number }) => [
          s.name,
          s.quantity,
          s.revenue_cents,
        ]),
      ).toEqual([
        ['Baño', 3, 75000],
        ['Corte de raza', 1, 40000],
      ])
      expect(
        r.products.map((p: { name: string; quantity: number; revenue_cents: number }) => [
          p.name,
          p.quantity,
          p.revenue_cents,
        ]),
      ).toEqual([
        ['Shampoo hipoalergénico 250 ml', 2, 29000],
        ['Alimento seco adulto 3 kg', 1, 38900],
      ])
      expect(r.services[0].sales_count).toBe(2)
    })
  })

  it('en un empate de cantidad gana el de mayor importe', async () => {
    await withTransaction(async (client) => {
      await seedSale(client, [bano(), corte()])
      const r = await topItems(client, USER_DUENO)
      expect(r.services.map((s: { name: string }) => s.name)).toEqual([
        'Corte de raza',
        'Baño',
      ])
    })
  })

  it('respeta el límite pedido', async () => {
    await withTransaction(async (client) => {
      await seedSale(client, [bano(), corte(), shampoo()])
      const r = await topItems(client, USER_DUENO, '2026-10-01', '2026-10-31', null, 1)
      expect(r.services).toHaveLength(1)
    })
  })

  it('una venta cancelada o abierta no cuenta', async () => {
    await withTransaction(async (client) => {
      await seedSale(client, [bano()], { status: 'cancelled' })
      await seedSale(client, [corte()], { status: 'open' })
      const r = await topItems(client, USER_DUENO)
      expect(r).toEqual({ services: [], products: [] })
    })
  })

  it('un insumo de consulta cobrado cuenta como producto', async () => {
    // Es una partida de producto ligada a una cita (11.14): debe aparecer con los productos.
    await withTransaction(async (client) => {
      const appt = await seedAppointment(client, USER_VET, { kind: 'veterinary' })
      await seedSale(client, [shampoo({ appointmentId: appt })])
      const r = await topItems(client, USER_DUENO)
      expect(r.products).toHaveLength(1)
      expect(r.services).toHaveLength(0)
    })
  })

  it('el IVA sale desglosado por partida y la cantidad mayor a 1 suma bien', async () => {
    await withTransaction(async (client) => {
      await seedSale(client, [bano({ unit: 11600, quantity: 3 })])
      const r = await topItems(client, USER_DUENO)
      expect(r.services[0]).toMatchObject({
        quantity: 3,
        revenue_cents: 34800,
        iva_cents: 34800 - Math.round(34800 / 1.16),
      })
    })
  })

  it('periodo sin ventas devuelve listas vacías, no error', async () => {
    await withTransaction(async (client) => {
      expect(await topItems(client, USER_DUENO, '2026-01-01', '2026-01-02')).toEqual({
        services: [],
        products: [],
      })
    })
  })

  it('el periodo se interpreta en la zona de la sucursal (23:30 del día 5 en CDMX)', async () => {
    await withTransaction(async (client) => {
      await seedSale(client, [bano()], { paidAt: '2026-10-06T05:30:00Z' })
      expect(
        (await topItems(client, USER_DUENO, '2026-10-05', '2026-10-05')).services,
      ).toHaveLength(1)
      expect(
        (await topItems(client, USER_DUENO, '2026-10-06', '2026-10-06')).services,
      ).toHaveLength(0)
    })
  })

  it('permisos: recepción y groomer no; negocio ajeno no; sucursal sin acceso no; límite inválido no', async () => {
    await withTransaction(async (client) => {
      await expectFails(
        client,
        () => topItems(client, USER_RECEPCION),
        /no tienes permiso/i,
      )
      await expectFails(
        client,
        () => topItems(client, USER_GROOMER),
        /no tienes permiso/i,
      )
      await expectFails(
        client,
        () =>
          topItems(
            client,
            USER_DUENO,
            '2026-10-01',
            '2026-10-31',
            null,
            20,
            TENANT_HUELLITAS,
          ),
        /no tienes permiso/i,
      )
      await expectFails(
        client,
        () => topItems(client, USER_DUENO, '2026-10-01', '2026-10-31', null, 0),
        /límite/i,
      )
    })
  })

  it('con el permiso concedido, recepción solo ve las ventas de su sucursal', async () => {
    await withTransaction(async (client) => {
      await setRole(client, 'service_role')
      await client.query(
        `update role_permissions set can_view = true where tenant_id = $1 and role = 'receptionist' and module = 'reports'`,
        [TENANT_PATITAS],
      )
      await seedSale(client, [bano()], { branch: BRANCH_CENTRO })
      await seedSale(client, [corte()], { branch: BRANCH_DEL_VALLE })
      const r = await topItems(client, USER_RECEPCION)
      expect(r.services.map((s: { name: string }) => s.name)).toEqual(['Baño'])
      await expectFails(
        client,
        () =>
          topItems(client, USER_RECEPCION, '2026-10-01', '2026-10-31', BRANCH_DEL_VALLE),
        /no tienes permiso/i,
      )
    })
  })
})

describe('report_staff_activity', () => {
  type Row = {
    user_id: string | null
    full_name: string
    appointments_completed: number
    services_cents: number
    products_cents: number
    total_cents: number
  }
  const byId = (rows: Row[]) =>
    Object.fromEntries(rows.map((r) => [r.user_id ?? 'none', r]))

  it('atribuye los servicios al empleado de la cita y cuenta solo las citas completadas', async () => {
    // Una cita agendada o cancelada no es trabajo hecho: no debe contar.
    await withTransaction(async (client) => {
      const a1 = await seedAppointment(client, USER_GROOMER)
      const a2 = await seedAppointment(client, USER_GROOMER)
      await seedAppointment(client, USER_GROOMER, { status: 'scheduled' })
      await seedAppointment(client, USER_GROOMER, { status: 'cancelled' })
      await seedAppointment(client, USER_VET, { kind: 'veterinary' })
      await seedSale(client, [bano({ appointmentId: a1 })])
      await seedSale(client, [corte({ appointmentId: a2 })])
      const r = byId(await staff(client, USER_DUENO))
      expect(r[USER_GROOMER]).toMatchObject({
        appointments_completed: 2,
        services_cents: 65000,
        products_cents: 0,
        total_cents: 65000,
      })
      // El vet atendió una cita pero no se cobró: cuenta la cita, no hay dinero.
      expect(r[USER_VET]).toMatchObject({ appointments_completed: 1, total_cents: 0 })
    })
  })

  it('un producto vendido con un servicio va al empleado del servicio', async () => {
    // Regla 2 de D17: el shampoo de un baño es del groomer, no de quien cobró.
    await withTransaction(async (client) => {
      const appt = await seedAppointment(client, USER_GROOMER)
      await seedSale(client, [bano({ appointmentId: appt }), shampoo()], {
        closedBy: USER_RECEPCION,
      })
      const r = byId(await staff(client, USER_DUENO))
      expect(r[USER_GROOMER]).toMatchObject({
        services_cents: 25000,
        products_cents: 14500,
      })
      expect(r[USER_RECEPCION]).toBeUndefined()
    })
  })

  it('con dos citas de distinto empleado en un ticket, el producto va a la cita más temprana', async () => {
    await withTransaction(async (client) => {
      const early = await seedAppointment(client, USER_GROOMER, {
        startsAt: '2026-10-05T16:00:00Z',
      })
      const late = await seedAppointment(client, USER_VET, {
        startsAt: '2026-10-05T18:00:00Z',
        kind: 'veterinary',
      })
      await seedSale(client, [
        bano({ appointmentId: late }),
        bano({ appointmentId: early }),
        alimento(),
      ])
      const r = byId(await staff(client, USER_DUENO))
      expect(r[USER_GROOMER].products_cents).toBe(38900)
      expect(r[USER_VET].products_cents).toBe(0)
    })
  })

  it('una venta de mostrador (sin citas) va a quien cobró', async () => {
    await withTransaction(async (client) => {
      await seedSale(client, [alimento()], { closedBy: USER_RECEPCION })
      const r = byId(await staff(client, USER_DUENO))
      expect(r[USER_RECEPCION]).toMatchObject({
        products_cents: 38900,
        services_cents: 0,
        appointments_completed: 0,
      })
    })
  })

  it('lo que no tiene empleado se agrupa en "Sin asignar" en vez de perderse', async () => {
    // Una venta antigua sin `closed_by` no debe desaparecer del reporte: el
    // dinero tiene que cuadrar con el total.
    await withTransaction(async (client) => {
      await seedSale(client, [alimento()], { closedBy: null })
      const rows = await staff(client, USER_DUENO)
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({
        user_id: null,
        full_name: 'Sin asignar',
        products_cents: 38900,
      })
    })
  })

  it('un empleado dado de baja sigue apareciendo si tuvo actividad en el periodo', async () => {
    await withTransaction(async (client) => {
      const appt = await seedAppointment(client, USER_GROOMER)
      await seedSale(client, [bano({ appointmentId: appt })])
      await setRole(client, 'service_role')
      await client.query(`update memberships set is_active = false where user_id = $1`, [
        USER_GROOMER,
      ])
      const r = byId(await staff(client, USER_DUENO))
      expect(r[USER_GROOMER].services_cents).toBe(25000)
      expect(r[USER_GROOMER].full_name).not.toBe('Sin asignar')
    })
  })

  it('las ventas canceladas no suman al empleado, y las citas se cuentan por su fecha local', async () => {
    await withTransaction(async (client) => {
      const appt = await seedAppointment(client, USER_GROOMER, {
        startsAt: '2026-10-06T05:30:00Z',
      }) // 23:30 del día 5 en CDMX
      await seedSale(client, [bano({ appointmentId: appt })], { status: 'cancelled' })
      const day5 = byId(await staff(client, USER_DUENO, '2026-10-05', '2026-10-05'))
      expect(day5[USER_GROOMER]).toMatchObject({
        appointments_completed: 1,
        total_cents: 0,
      })
      expect(await staff(client, USER_DUENO, '2026-10-06', '2026-10-06')).toEqual([])
    })
  })

  it('ordena por importe total, de mayor a menor', async () => {
    await withTransaction(async (client) => {
      const a1 = await seedAppointment(client, USER_GROOMER)
      const a2 = await seedAppointment(client, USER_VET, { kind: 'veterinary' })
      await seedSale(client, [bano({ appointmentId: a1 })])
      await seedSale(client, [corte({ appointmentId: a2 })])
      const rows: Row[] = await staff(client, USER_DUENO)
      expect(rows.map((r) => r.user_id)).toEqual([USER_VET, USER_GROOMER])
    })
  })

  it('permisos y aislamiento: sin permiso no, negocio ajeno no, y por sucursal', async () => {
    await withTransaction(async (client) => {
      await expectFails(client, () => staff(client, USER_RECEPCION), /no tienes permiso/i)
      await expectFails(
        client,
        () =>
          staff(client, USER_DUENO, '2026-10-01', '2026-10-31', null, TENANT_HUELLITAS),
        /no tienes permiso/i,
      )
      await setRole(client, 'service_role')
      await client.query(
        `update role_permissions set can_view = true where tenant_id = $1 and role = 'receptionist' and module = 'reports'`,
        [TENANT_PATITAS],
      )
      const aCentro = await seedAppointment(client, USER_GROOMER, {
        branch: BRANCH_CENTRO,
      })
      const aValle = await seedAppointment(client, USER_VET, {
        branch: BRANCH_DEL_VALLE,
        kind: 'veterinary',
      })
      await seedSale(client, [bano({ appointmentId: aCentro })], {
        branch: BRANCH_CENTRO,
      })
      await seedSale(client, [corte({ appointmentId: aValle })], {
        branch: BRANCH_DEL_VALLE,
      })
      const r = byId(await staff(client, USER_RECEPCION))
      expect(Object.keys(r)).toEqual([USER_GROOMER]) // solo lo de su sucursal
    })
  })
})
