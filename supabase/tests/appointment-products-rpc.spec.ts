// Prueba los insumos usados en una consulta veterinaria (fase 11, tarea 11.12 /
// HMH Four #2042): tabla appointment_products y las RPC add_appointment_product()
// / remove_appointment_product(). Sesión simulada con pg, en transacciones que
// siempre se revierten (mismo patrón que checkout-rpc.spec.ts).
//
// Qué se protege: que la existencia SIEMPRE cuadre con las líneas registradas.
// Si una línea pudiera existir sin su descuento (o al revés), el inventario
// dejaría de ser confiable.
import { afterAll, describe, expect, it } from 'vitest'
import type { PoolClient } from 'pg'

import { closePool, insertAuthUser, setRole, tryQuery, withTransaction } from './helpers'
import {
  BRANCH_DEL_VALLE,
  CUSTOMER_SOFIA,
  PET_ROCKY,
  PRODUCT_COLLAR_INACTIVO,
  PRODUCT_HUELLITAS,
  PRODUCT_SHAMPOO,
  SERVICE_BANO,
  TENANT_HUELLITAS,
  TENANT_PATITAS,
  USER_DUENO,
  USER_GROOMER,
  USER_RECEPCION,
  USER_VET,
} from './fixtures'

afterAll(closePool)

async function seedStock(
  client: PoolClient,
  productId: string,
  quantity: number,
  branchId = BRANCH_DEL_VALLE,
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
  branchId = BRANCH_DEL_VALLE,
): Promise<number> {
  await setRole(client, 'service_role')
  const { rows } = await client.query(
    'select coalesce(sum(quantity), 0)::int as stock from stock_movements where product_id = $1 and branch_id = $2',
    [productId, branchId],
  )
  return rows[0].stock
}

/** Cita en Del Valle (donde trabaja el vet), por defecto veterinaria y "en curso". */
async function seedAppointment(
  client: PoolClient,
  { kind = 'veterinary', status = 'in_progress', branch = BRANCH_DEL_VALLE } = {},
): Promise<string> {
  await setRole(client, 'service_role')
  const { rows } = await client.query(
    `insert into appointments (tenant_id, branch_id, customer_id, pet_id, kind, employee_user_id, starts_at, ends_at, status, created_by)
     values ($1, $2, $3, $4, $5, $6, now() + interval '30 days', now() + interval '30 days' + interval '60 minutes', $7, $6)
     returning id`,
    [TENANT_PATITAS, branch, CUSTOMER_SOFIA, PET_ROCKY, kind, USER_VET, status],
  )
  return rows[0].id
}

async function addLine(
  client: PoolClient,
  appointmentId: string,
  productId: string,
  quantity: number,
  billable = true,
): Promise<string> {
  const { rows } = await client.query(
    'select add_appointment_product($1, $2, $3, $4) as id',
    [appointmentId, productId, quantity, billable],
  )
  return rows[0].id
}

describe('add_appointment_product(): registrar un insumo', () => {
  it('guarda la línea con su snapshot y baja la existencia en el momento', async () => {
    // Qué se rompería: el vet anota lo que usó y el inventario no se entera.
    await withTransaction(async (client) => {
      await seedStock(client, PRODUCT_SHAMPOO, 5)
      const appointmentId = await seedAppointment(client)

      await setRole(client, 'authenticated', USER_VET)
      const lineId = await addLine(client, appointmentId, PRODUCT_SHAMPOO, 2, false)

      const { rows } = await client.query(
        'select name_snapshot, quantity, is_billable, unit_price_cents, tax_rate_bp from appointment_products where id = $1',
        [lineId],
      )
      expect(rows[0]).toMatchObject({ quantity: 2, is_billable: false })
      expect(rows[0].name_snapshot).toBeTruthy()
      expect(await stockOf(client, PRODUCT_SHAMPOO)).toBe(3)
    })
  })

  it('el dueño también puede registrar', async () => {
    await withTransaction(async (client) => {
      await seedStock(client, PRODUCT_SHAMPOO, 5)
      const appointmentId = await seedAppointment(client)
      await setRole(client, 'authenticated', USER_DUENO)
      await addLine(client, appointmentId, PRODUCT_SHAMPOO, 1)
      expect(await stockOf(client, PRODUCT_SHAMPOO)).toBe(4)
    })
  })

  it('el groomer y la recepción no pueden registrar insumos', async () => {
    // Qué se rompería: cualquier empleado movería inventario "de consulta".
    await withTransaction(async (client) => {
      await seedStock(client, PRODUCT_SHAMPOO, 5)
      const appointmentId = await seedAppointment(client)

      for (const user of [USER_GROOMER, USER_RECEPCION]) {
        await setRole(client, 'authenticated', user)
        await client.query('savepoint s')
        await expect(addLine(client, appointmentId, PRODUCT_SHAMPOO, 1)).rejects.toThrow(
          /permiso para registrar insumos|acceso a esta sucursal/i,
        )
        await client.query('rollback to savepoint s')
      }
      expect(await stockOf(client, PRODUCT_SHAMPOO)).toBe(5)
    })
  })

  it('rechaza un producto sin existencia y una cantidad mayor a la existencia', async () => {
    // Qué se rompería: consumir lo que no hay y dejar existencia negativa.
    await withTransaction(async (client) => {
      const appointmentId = await seedAppointment(client)
      await setRole(client, 'authenticated', USER_VET)

      await client.query('savepoint s1')
      await expect(addLine(client, appointmentId, PRODUCT_SHAMPOO, 1)).rejects.toThrow(
        /no tiene existencia/i,
      )
      await client.query('rollback to savepoint s1')

      await seedStock(client, PRODUCT_SHAMPOO, 2)
      await setRole(client, 'authenticated', USER_VET)
      await expect(addLine(client, appointmentId, PRODUCT_SHAMPOO, 3)).rejects.toThrow(
        /no hay existencia suficiente/i,
      )
    })
  })

  it('si no alcanza, no queda la línea (todo o nada)', async () => {
    await withTransaction(async (client) => {
      await seedStock(client, PRODUCT_SHAMPOO, 2)
      const appointmentId = await seedAppointment(client)
      await setRole(client, 'authenticated', USER_VET)
      await client.query('savepoint s')
      await expect(addLine(client, appointmentId, PRODUCT_SHAMPOO, 3)).rejects.toThrow()
      await client.query('rollback to savepoint s')
      const { rows } = await client.query(
        'select count(*)::int as n from appointment_products where appointment_id = $1',
        [appointmentId],
      )
      expect(rows[0].n).toBe(0)
    })
  })

  it('rechaza producto de otro negocio, producto inactivo y cantidad inválida', async () => {
    // Qué se rompería: la RPC salta RLS; sin su propio filtro usaría producto ajeno.
    await withTransaction(async (client) => {
      const appointmentId = await seedAppointment(client)
      await setRole(client, 'authenticated', USER_VET)
      for (const [product, quantity, message] of [
        [PRODUCT_HUELLITAS, 1, /no existe o no está disponible/i],
        [PRODUCT_COLLAR_INACTIVO, 1, /no existe o no está disponible/i],
        [PRODUCT_SHAMPOO, 0, /mayor a cero/i],
      ] as const) {
        await client.query('savepoint s')
        await expect(addLine(client, appointmentId, product, quantity)).rejects.toThrow(
          message,
        )
        await client.query('rollback to savepoint s')
      }
    })
  })

  it('solo en consultas veterinarias, no en estética ni en citas canceladas', async () => {
    await withTransaction(async (client) => {
      await seedStock(client, PRODUCT_SHAMPOO, 5)
      const grooming = await seedAppointment(client, { kind: 'grooming' })
      const cancelled = await seedAppointment(client, { status: 'cancelled' })
      await setRole(client, 'authenticated', USER_DUENO)

      await client.query('savepoint s')
      await expect(addLine(client, grooming, PRODUCT_SHAMPOO, 1)).rejects.toThrow(
        /consultas veterinarias/i,
      )
      await client.query('rollback to savepoint s')
      await expect(addLine(client, cancelled, PRODUCT_SHAMPOO, 1)).rejects.toThrow(
        /cancelada/i,
      )
    })
  })

  it('una cita ya cobrada no admite insumos nuevos', async () => {
    // Qué se rompería: agregar un insumo a un ticket que ya se pagó.
    await withTransaction(async (client) => {
      await seedStock(client, PRODUCT_SHAMPOO, 5)
      const appointmentId = await seedAppointment(client, { status: 'completed' })
      await setRole(client, 'service_role')
      await client.query(
        `insert into appointment_services (tenant_id, appointment_id, service_id, name_snapshot, unit_price_cents, quantity, duration_minutes_snapshot)
         select $1, $2, id, name, price_cents, 1, duration_minutes from services where id = $3`,
        [TENANT_PATITAS, appointmentId, SERVICE_BANO],
      )
      await setRole(client, 'authenticated', USER_DUENO)
      await client.query('select checkout_appointment($1, $2::jsonb, 0)', [
        appointmentId,
        JSON.stringify([{ method: 'cash', amount_cents: 25000 }]),
      ])

      await expect(addLine(client, appointmentId, PRODUCT_SHAMPOO, 1)).rejects.toThrow(
        /ya fue cobrada/i,
      )
    })
  })
})

describe('remove_appointment_product(): quitar una línea', () => {
  it('devuelve exactamente la existencia que había sacado', async () => {
    // Qué se rompería: el vet se equivoca, quita la línea y la pieza se pierde.
    await withTransaction(async (client) => {
      await seedStock(client, PRODUCT_SHAMPOO, 5)
      const appointmentId = await seedAppointment(client)
      await setRole(client, 'authenticated', USER_VET)
      const lineId = await addLine(client, appointmentId, PRODUCT_SHAMPOO, 3)
      expect(await stockOf(client, PRODUCT_SHAMPOO)).toBe(2)

      await setRole(client, 'authenticated', USER_VET)
      await client.query('select remove_appointment_product($1)', [lineId])
      expect(await stockOf(client, PRODUCT_SHAMPOO)).toBe(5)

      // La línea queda oculta (borrado suave), no borrada. stockOf() ya dejó la
      // sesión como service_role, que ve también las ocultas.
      const { rows } = await client.query(
        'select deleted_at from appointment_products where id = $1',
        [lineId],
      )
      expect(rows[0].deleted_at).not.toBeNull()
    })
  })

  it('quitar dos veces la misma línea no devuelve de más', async () => {
    await withTransaction(async (client) => {
      await seedStock(client, PRODUCT_SHAMPOO, 5)
      const appointmentId = await seedAppointment(client)
      await setRole(client, 'authenticated', USER_VET)
      const lineId = await addLine(client, appointmentId, PRODUCT_SHAMPOO, 3)
      await client.query('select remove_appointment_product($1)', [lineId])
      await client.query('savepoint s')
      await expect(
        client.query('select remove_appointment_product($1)', [lineId]),
      ).rejects.toThrow(/no existe/i)
      await client.query('rollback to savepoint s')
      expect(await stockOf(client, PRODUCT_SHAMPOO)).toBe(5)
    })
  })

  it('groomer y recepción no pueden quitar líneas', async () => {
    await withTransaction(async (client) => {
      await seedStock(client, PRODUCT_SHAMPOO, 5)
      const appointmentId = await seedAppointment(client)
      await setRole(client, 'authenticated', USER_VET)
      const lineId = await addLine(client, appointmentId, PRODUCT_SHAMPOO, 1)

      for (const user of [USER_GROOMER, USER_RECEPCION]) {
        await setRole(client, 'authenticated', user)
        await client.query('savepoint s')
        await expect(
          client.query('select remove_appointment_product($1)', [lineId]),
        ).rejects.toThrow(/permiso|acceso a esta sucursal|no existe/i)
        await client.query('rollback to savepoint s')
      }
      expect(await stockOf(client, PRODUCT_SHAMPOO)).toBe(4)
    })
  })
})

describe('appointment_products: lectura y escritura directa (RLS)', () => {
  async function seedLine(client: PoolClient): Promise<string> {
    await seedStock(client, PRODUCT_SHAMPOO, 5)
    const appointmentId = await seedAppointment(client)
    await setRole(client, 'authenticated', USER_VET)
    await addLine(client, appointmentId, PRODUCT_SHAMPOO, 1)
    return appointmentId
  }

  it('quien ve la cita ve sus líneas; otra sucursal y otro negocio, no', async () => {
    // Qué se rompería: ver los insumos (y precios) de citas ajenas.
    await withTransaction(async (client) => {
      const appointmentId = await seedLine(client)
      const count = async (user: string) => {
        await setRole(client, 'authenticated', user)
        const { rows } = await client.query(
          'select count(*)::int as n from appointment_products where appointment_id = $1',
          [appointmentId],
        )
        return rows[0].n
      }
      expect(await count(USER_VET)).toBe(1)
      expect(await count(USER_DUENO)).toBe(1)
      // Recepción y groomer trabajan en Centro; la cita es de Del Valle.
      expect(await count(USER_RECEPCION)).toBe(0)
      expect(await count(USER_GROOMER)).toBe(0)
    })
  })

  it('nadie escribe directo en la tabla (sin pasar por la RPC)', async () => {
    // Qué se rompería: una línea sin su descuento de stock; el inventario
    // diría una cosa y las consultas otra.
    await withTransaction(async (client) => {
      const appointmentId = await seedLine(client)
      for (const user of [USER_VET, USER_DUENO]) {
        await setRole(client, 'authenticated', user)
        const insertError = await tryQuery(
          client,
          `insert into appointment_products (tenant_id, appointment_id, product_id, name_snapshot, unit_price_cents, tax_rate_bp, quantity, created_by)
           values ($1, $2, $3, 'x', 1, 1600, 1, $4)`,
          [TENANT_PATITAS, appointmentId, PRODUCT_SHAMPOO, user],
        )
        expect(insertError).toMatch(/row-level security/i)

        const update = await client.query(
          'update appointment_products set quantity = 99 where appointment_id = $1',
          [appointmentId],
        )
        expect(update.rowCount).toBe(0)
        const del = await client.query(
          'delete from appointment_products where appointment_id = $1',
          [appointmentId],
        )
        expect(del.rowCount).toBe(0)
      }
    })
  })

  it('un dueño de otro negocio no puede usar la RPC sobre una cita ajena', async () => {
    // Qué se rompería: la RPC salta RLS; sin revalidar, cualquiera registraría
    // insumos (y movería inventario) en citas de otro negocio.
    await withTransaction(async (client) => {
      // insertAuthUser() va ANTES de cambiar de rol: solo el rol dueño escribe en auth.
      const otherOwner = 'a9000000-0000-4000-8000-000000000001'
      await insertAuthUser(client, otherOwner, 'dueno-otro@example.test')
      const appointmentId = await seedLine(client)
      await setRole(client, 'service_role')
      await client.query(
        "insert into memberships (tenant_id, user_id, role) values ($1, $2, 'owner')",
        [TENANT_HUELLITAS, otherOwner],
      )
      await setRole(client, 'authenticated', otherOwner)
      await expect(addLine(client, appointmentId, PRODUCT_SHAMPOO, 1)).rejects.toThrow(
        /no perteneces/i,
      )
    })
  })
})
