// Catálogo de cirugías y su cobro (fase 32, PLAN.md D30 punto 9; migración
// 20261026120000_surgeries.sql): save_surgery_package(), apply_surgery_lines(),
// remove_surgery_line() y el cobro de los renglones sin producto en checkout_appointment().
//
// Qué se protege: que la cirugía se cobre exactamente por lo que dice el paquete (precio de
// ese día), que los consumibles bajen del inventario y los honorarios no, y que el inventario
// vuelva si se quita un renglón.
import type { PoolClient } from 'pg'
import { afterAll, describe, expect, it } from 'vitest'

import { closePool, setRole, withTransaction } from './helpers'
import {
  BRANCH_DEL_VALLE,
  CUSTOMER_SOFIA,
  PET_ROCKY,
  PRODUCT_HUELLITAS,
  PRODUCT_SHAMPOO,
  SERVICE_CONSULTA_GENERAL,
  TENANT_HUELLITAS,
  TENANT_PATITAS,
  USER_DUENO,
  USER_GROOMER,
  USER_RECEPCION,
  USER_VET,
} from './fixtures'

afterAll(closePool)

const CASH = [{ method: 'cash', amount_cents: 1000000 }]

const ITEMS = [
  {
    kind: 'fee',
    description: 'Honorarios del cirujano',
    quantity: 1,
    unit_price_cents: 150000,
  },
  {
    kind: 'consumable',
    product_id: PRODUCT_SHAMPOO,
    description: 'Material de sutura',
    quantity: 2,
    unit_price_cents: 8000,
    tax_rate_bp: 1600,
  },
]

async function savePackage(
  client: PoolClient,
  user: string,
  items: unknown[] = ITEMS,
  id: string | null = null,
  name = 'Cirugía de prueba',
) {
  await setRole(client, 'authenticated', user)
  const { rows } = await client.query(
    'select save_surgery_package($1, $2, $3, $4, $5::jsonb) as id',
    [TENANT_PATITAS, id, name, 'Incluye anestesia', JSON.stringify(items)],
  )
  return rows[0].id as string
}

async function seedStock(client: PoolClient, quantity: number) {
  await setRole(client, 'service_role')
  await client.query(
    `insert into stock_movements (tenant_id, branch_id, product_id, created_by, movement_type, quantity)
     values ($1, $2, $3, $4, 'purchase', $5)`,
    [TENANT_PATITAS, BRANCH_DEL_VALLE, PRODUCT_SHAMPOO, USER_DUENO, quantity],
  )
}

async function stock(client: PoolClient): Promise<number> {
  await setRole(client, 'service_role')
  const { rows } = await client.query(
    'select coalesce(sum(quantity), 0)::int as n from stock_movements where product_id = $1 and branch_id = $2',
    [PRODUCT_SHAMPOO, BRANCH_DEL_VALLE],
  )
  return rows[0].n
}

async function vetAppointment(
  client: PoolClient,
  status = 'in_progress',
  kind = 'veterinary',
) {
  await setRole(client, 'service_role')
  const { rows } = await client.query(
    `insert into appointments (tenant_id, branch_id, customer_id, pet_id, kind, employee_user_id, starts_at, ends_at, status, created_by)
     values ($1, $2, $3, $4, $5, $6, now() + interval '30 days', now() + interval '30 days' + interval '60 minutes', $7, $6)
     returning id`,
    [TENANT_PATITAS, BRANCH_DEL_VALLE, CUSTOMER_SOFIA, PET_ROCKY, kind, USER_VET, status],
  )
  await client.query(
    `insert into appointment_services (tenant_id, appointment_id, service_id, name_snapshot, unit_price_cents, quantity, duration_minutes_snapshot)
     select $1, $2, id, name, price_cents, 1, duration_minutes from services where id = $3`,
    [TENANT_PATITAS, rows[0].id, SERVICE_CONSULTA_GENERAL],
  )
  return rows[0].id as string
}

async function apply(
  client: PoolClient,
  user: string,
  appointmentId: string,
  packageId: string | null,
  lines: unknown[],
) {
  await setRole(client, 'authenticated', user)
  const { rows } = await client.query(
    'select apply_surgery_lines($1, $2, $3::jsonb) as n',
    [appointmentId, packageId, JSON.stringify(lines)],
  )
  return rows[0].n as number
}

describe('save_surgery_package()', () => {
  // Qué prueba: dueño y veterinario guardan un paquete con sus renglones; recepción y groomer no.
  // Qué se rompería: cualquiera cambiaría el precio de las cirugías.
  it('lo guardan dueño y veterinario; recepción y groomer no', async () => {
    await withTransaction(async (client) => {
      expect(await savePackage(client, USER_DUENO, ITEMS, null, 'Cirugía A')).toBeTruthy()
      expect(await savePackage(client, USER_VET, ITEMS, null, 'Cirugía B')).toBeTruthy()
      for (const user of [USER_RECEPCION, USER_GROOMER]) {
        await client.query('savepoint s')
        await expect(savePackage(client, user)).rejects.toThrow(/permiso/i)
        await client.query('rollback to savepoint s')
      }
    })
  })

  // Qué prueba: dos paquetes no se llaman igual (con un mensaje claro, no el del índice).
  it('rechaza un nombre repetido', async () => {
    await withTransaction(async (client) => {
      await savePackage(client, USER_VET, ITEMS, null, 'Castración')
      await client.query('savepoint s')
      await expect(
        savePackage(client, USER_VET, ITEMS, null, ' castración '),
      ).rejects.toThrow(/ya hay una cirugía con ese nombre/i)
      await client.query('rollback to savepoint s')
    })
  })

  // Qué prueba: corregir un paquete reemplaza sus renglones (los anteriores se ocultan).
  it('corregir el paquete reemplaza sus renglones', async () => {
    await withTransaction(async (client) => {
      const id = await savePackage(client, USER_VET)
      await savePackage(client, USER_VET, [ITEMS[0]], id)
      await setRole(client, 'service_role')
      const { rows } = await client.query(
        'select count(*)::int as n from surgery_package_items where package_id = $1 and deleted_at is null',
        [id],
      )
      expect(rows[0].n).toBe(1)
    })
  })

  // Qué prueba: reglas de forma: sin renglones, honorario con producto y producto ajeno.
  it('rechaza un paquete vacío, un honorario con producto y un producto de otro negocio', async () => {
    await withTransaction(async (client) => {
      await client.query('savepoint s')
      await expect(savePackage(client, USER_VET, [])).rejects.toThrow(
        /al menos un renglón/i,
      )
      await client.query('rollback to savepoint s')

      await client.query('savepoint s')
      await expect(
        savePackage(client, USER_VET, [
          {
            kind: 'fee',
            product_id: PRODUCT_SHAMPOO,
            description: 'x',
            quantity: 1,
            unit_price_cents: 1,
          },
        ]),
      ).rejects.toThrow(/honorario no lleva producto|fee_without_product/i)
      await client.query('rollback to savepoint s')

      await client.query('savepoint s')
      await expect(
        savePackage(client, USER_VET, [
          {
            kind: 'consumable',
            product_id: PRODUCT_HUELLITAS,
            description: 'x',
            quantity: 1,
            unit_price_cents: 1,
          },
        ]),
      ).rejects.toThrow(/no existe/i)
      await client.query('rollback to savepoint s')
    })
  })

  // Qué prueba: aislamiento: el dueño de otro negocio no puede tocar el paquete.
  it('otro negocio no ve ni corrige el paquete', async () => {
    await withTransaction(async (client) => {
      const id = await savePackage(client, USER_DUENO)
      await setRole(client, 'service_role')
      const { rows } = await client.query(
        'select count(*)::int as n from surgery_packages where tenant_id = $1 and id = $2',
        [TENANT_HUELLITAS, id],
      )
      expect(rows[0].n).toBe(0)
    })
  })
})

describe('aplicar una cirugía a una cita y cobrarla', () => {
  // Qué prueba: el consumible baja de inventario con su cantidad y el honorario no; los dos
  // quedan como renglones de la cita.
  // Qué se rompería: la cirugía no descontaría el material, o descontaría un honorario.
  it('el consumible baja existencia y el honorario no', async () => {
    await withTransaction(async (client) => {
      await seedStock(client, 10)
      const pkg = await savePackage(client, USER_VET)
      const appt = await vetAppointment(client)
      const n = await apply(client, USER_VET, appt, pkg, ITEMS)
      expect(n).toBe(2)
      expect(await stock(client)).toBe(8)
    })
  })

  // Qué prueba: al cobrar, el ticket trae el honorario (sin servicio ni producto, con sus
  // claves del SAT) y el consumible con el PRECIO DEL PAQUETE, no el del catálogo.
  // Qué se rompería: la cirugía se cobraría con precios que no son los acordados.
  it('el ticket trae el honorario y el consumible al precio del paquete', async () => {
    await withTransaction(async (client) => {
      await seedStock(client, 10)
      const pkg = await savePackage(client, USER_VET)
      const appt = await vetAppointment(client, 'completed')
      await apply(client, USER_DUENO, appt, pkg, ITEMS)

      await setRole(client, 'authenticated', USER_DUENO)
      const { rows } = await client.query(
        'select checkout_appointment($1, $2::jsonb, 0, $3::jsonb) as id',
        [appt, JSON.stringify(CASH), '[]'],
      )
      await setRole(client, 'service_role')
      const items = await client.query(
        `select description, quantity, unit_price_cents, line_total_cents, item_type, service_id, product_id,
                sat_product_code_snapshot, sat_unit_code_snapshot
           from sale_items where sale_id = $1 order by description`,
        [rows[0].id],
      )
      const fee = items.rows.find((r) => r.description === 'Honorarios del cirujano')
      expect(fee).toMatchObject({
        quantity: 1,
        unit_price_cents: 150000,
        item_type: 'service',
        service_id: null,
        product_id: null,
        sat_product_code_snapshot: '70122000',
        sat_unit_code_snapshot: 'E48',
      })
      const supply = items.rows.find((r) => r.product_id === PRODUCT_SHAMPOO)
      expect(supply).toMatchObject({
        quantity: 2,
        unit_price_cents: 8000,
        line_total_cents: 16000,
      })
      // El total incluye el servicio de la cita + el honorario + el consumible.
      const sale = await client.query('select total_cents from sales where id = $1', [
        rows[0].id,
      ])
      expect(sale.rows[0].total_cents).toBe(
        items.rows.reduce((sum, r) => sum + r.line_total_cents, 0),
      )
      // Cobrar no vuelve a descontar la existencia.
      expect(await stock(client)).toBe(8)
    })
  })

  // Qué prueba: un renglón "de uso interno" (is_billable false) no llega al ticket.
  it('un renglón de uso interno no se cobra', async () => {
    await withTransaction(async (client) => {
      const appt = await vetAppointment(client, 'completed')
      await apply(client, USER_VET, appt, null, [
        {
          kind: 'fee',
          description: 'Cortesía',
          quantity: 1,
          unit_price_cents: 50000,
          is_billable: false,
        },
      ])
      await setRole(client, 'authenticated', USER_DUENO)
      const { rows } = await client.query(
        'select checkout_appointment($1, $2::jsonb, 0, $3::jsonb) as id',
        [appt, JSON.stringify(CASH), '[]'],
      )
      await setRole(client, 'service_role')
      const items = await client.query(
        'select description from sale_items where sale_id = $1',
        [rows[0].id],
      )
      expect(items.rows.map((r) => r.description)).not.toContain('Cortesía')
    })
  })

  // Qué prueba: quitar un renglón con producto devuelve la existencia y lo oculta.
  it('quitar un renglón devuelve la existencia', async () => {
    await withTransaction(async (client) => {
      await seedStock(client, 10)
      const appt = await vetAppointment(client)
      await apply(client, USER_VET, appt, null, [ITEMS[1]])
      expect(await stock(client)).toBe(8)

      await setRole(client, 'service_role')
      const line = await client.query(
        'select id from appointment_surgery_lines where appointment_id = $1 and deleted_at is null',
        [appt],
      )
      await setRole(client, 'authenticated', USER_VET)
      await client.query('select remove_surgery_line($1)', [line.rows[0].id])
      expect(await stock(client)).toBe(10)
    })
  })

  // Qué prueba: sin existencia suficiente no se aplica nada (todo o nada).
  it('sin existencia no se aplica el paquete y no queda nada', async () => {
    await withTransaction(async (client) => {
      await seedStock(client, 1) // el paquete pide 2
      const appt = await vetAppointment(client)
      await client.query('savepoint s')
      await expect(apply(client, USER_VET, appt, null, ITEMS)).rejects.toThrow(
        /existencia/i,
      )
      await client.query('rollback to savepoint s')
      await setRole(client, 'service_role')
      const { rows } = await client.query(
        'select count(*)::int as n from appointment_surgery_lines where appointment_id = $1',
        [appt],
      )
      expect(rows[0].n).toBe(0)
    })
  })

  // Qué prueba: las mismas reglas que los insumos: groomer y recepción no aplican; una cita de
  // estética tampoco; y una cita ya cobrada no admite cambios.
  it('rechaza groomer, recepción, cita de estética y cita ya cobrada', async () => {
    await withTransaction(async (client) => {
      const appt = await vetAppointment(client)
      for (const user of [USER_GROOMER, USER_RECEPCION]) {
        await client.query('savepoint s')
        await expect(apply(client, user, appt, null, [ITEMS[0]])).rejects.toThrow(
          /permiso|acceso/i,
        )
        await client.query('rollback to savepoint s')
      }

      const grooming = await vetAppointment(client, 'in_progress', 'grooming')
      await client.query('savepoint s')
      await expect(apply(client, USER_VET, grooming, null, [ITEMS[0]])).rejects.toThrow(
        /veterinarias/i,
      )
      await client.query('rollback to savepoint s')

      const done = await vetAppointment(client, 'completed')
      await setRole(client, 'authenticated', USER_DUENO)
      await client.query('select checkout_appointment($1, $2::jsonb, 0, $3::jsonb)', [
        done,
        JSON.stringify(CASH),
        '[]',
      ])
      await client.query('savepoint s')
      await expect(apply(client, USER_DUENO, done, null, [ITEMS[0]])).rejects.toThrow(
        /ya fue cobrada/i,
      )
      await client.query('rollback to savepoint s')
    })
  })
})
