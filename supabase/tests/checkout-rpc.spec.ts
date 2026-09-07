// Prueba checkout_appointment() (migración 20260907151852_checkout_rpc.sql,
// tareas 5.7-5.10): el RPC que cobra una cita atendida en una sola
// transacción. Sesión simulada vía pg (mismo patrón que
// appointments-rls.spec.ts), no una sesión real de Supabase, por dos
// razones: estos tests necesitan controlar el ESTADO exacto de la cita
// (marcarla 'completed' a mano, sin repetir el flujo real de agendar y
// atender de las fases 3-4) y, en el caso del pago insuficiente, seguir
// consultando la MISMA transacción después de un error para comprobar que
// no quedó nada escrito — algo que un SAVEPOINT permite y una llamada RPC
// normal por HTTP no necesita (cada request de PostgREST ya es su propia
// transacción).
import { afterAll, describe, expect, it } from 'vitest'
import type { PoolClient } from 'pg'

import { sumLineItems } from '@/lib/money'

import { closePool, setRole, withTransaction } from './helpers'
import {
  BRANCH_CENTRO,
  BRANCH_DEL_VALLE,
  CUSTOMER_SOFIA,
  PET_ROCKY,
  SERVICE_BANO,
  SERVICE_CORTE_RAZA,
  TENANT_HUELLITAS,
  TENANT_PATITAS,
  USER_DUENO,
  USER_GROOMER,
  USER_RECEPCION,
} from './fixtures'

afterAll(closePool)

interface ServiceLine {
  serviceId: string
  quantity: number
}

/**
 * Crea (como service_role) una cita YA atendida (status = 'completed') con
 * los servicios pedidos, saltándose el flujo real de agendar/atender de las
 * fases 3-4 — estos tests solo necesitan su RESULTADO (una cita completada
 * con sus appointment_services), no repetirlo paso a paso.
 */
async function seedCompletedAppointment(
  client: PoolClient,
  lines: ServiceLine[],
  options: { branchId?: string; employeeUserId?: string } = {},
): Promise<string> {
  const branchId = options.branchId ?? BRANCH_CENTRO
  const employeeUserId = options.employeeUserId ?? USER_GROOMER

  await setRole(client, 'service_role')
  const { rows } = await client.query(
    `insert into appointments (tenant_id, branch_id, customer_id, pet_id, kind, employee_user_id, starts_at, ends_at, status, created_by)
     values ($1, $2, $3, $4, 'grooming', $5, now() + interval '30 days', now() + interval '30 days' + interval '60 minutes', 'completed', $5)
     returning id`,
    [TENANT_PATITAS, branchId, CUSTOMER_SOFIA, PET_ROCKY, employeeUserId],
  )
  const appointmentId: string = rows[0].id

  for (const line of lines) {
    await client.query(
      `insert into appointment_services (tenant_id, appointment_id, service_id, name_snapshot, unit_price_cents, quantity, duration_minutes_snapshot)
       select $1, $2, id, name, price_cents, $3, duration_minutes from services where id = $4`,
      [TENANT_PATITAS, appointmentId, line.quantity, line.serviceId],
    )
  }

  return appointmentId
}

/** Llama checkout_appointment() como el rol/usuario ya fijado en `client`. */
async function checkout(
  client: PoolClient,
  appointmentId: string,
  payments: Array<{ method: string; amount_cents: number; reference?: string }>,
  discountCents = 0,
): Promise<string> {
  const { rows } = await client.query(
    'select checkout_appointment($1, $2::jsonb, $3) as sale_id',
    [appointmentId, JSON.stringify(payments), discountCents],
  )
  return rows[0].sale_id
}

describe('checkout_appointment(): cobro exitoso (tarea 5.7)', () => {
  it('deja una venta con su partida y su pago consistentes entre sí', async () => {
    await withTransaction(async (client) => {
      const appointmentId = await seedCompletedAppointment(client, [
        { serviceId: SERVICE_BANO, quantity: 1 },
      ])

      await setRole(client, 'authenticated', USER_RECEPCION)
      const saleId = await checkout(client, appointmentId, [
        { method: 'cash', amount_cents: 25000 },
      ])

      const { rows: saleRows } = await client.query(
        'select status, subtotal_cents, tax_cents, discount_cents, total_cents, folio from sales where id = $1',
        [saleId],
      )
      const sale = saleRows[0]
      // Baño ($250.00, IVA 16% incluido) desglosa a 21552 neto + 3448 IVA
      // — splitTaxIncluded(25000, 1600), verificado en lib/money.spec.ts.
      expect(sale).toMatchObject({
        status: 'paid',
        subtotal_cents: 21552,
        tax_cents: 3448,
        discount_cents: 0,
        total_cents: 25000,
      })
      expect(sale.folio).toBeGreaterThan(0)
      // net + tax === gross, la misma garantía de lib/money.ts.
      expect(sale.subtotal_cents + sale.tax_cents).toBe(sale.total_cents)

      const { rows: itemRows } = await client.query(
        'select description, quantity, unit_price_cents, tax_rate_bp, tax_cents, line_total_cents, appointment_id from sale_items where sale_id = $1',
        [saleId],
      )
      expect(itemRows).toEqual([
        {
          description: 'Baño',
          quantity: 1,
          unit_price_cents: 25000,
          tax_rate_bp: 1600,
          tax_cents: 3448,
          line_total_cents: 25000,
          appointment_id: appointmentId,
        },
      ])

      const { rows: paymentRows } = await client.query(
        'select method, amount_cents, status, reference from payments where sale_id = $1',
        [saleId],
      )
      expect(paymentRows).toEqual([
        { method: 'cash', amount_cents: 25000, status: 'approved', reference: null },
      ])
    })
  })

  it('un pago simulado (tarjeta) sin referencia recibe una referencia falsa reconocible', async () => {
    // CLAUDE.md §6.5: card/transfer_spei/openpay se simulan en v1 con
    // status = 'simulated_approved' y una referencia falsa — se prueba que
    // el RPC de verdad la genera cuando el llamador no manda una.
    await withTransaction(async (client) => {
      const appointmentId = await seedCompletedAppointment(client, [
        { serviceId: SERVICE_BANO, quantity: 1 },
      ])

      await setRole(client, 'authenticated', USER_RECEPCION)
      const saleId = await checkout(client, appointmentId, [
        { method: 'card', amount_cents: 25000 },
      ])

      const { rows } = await client.query(
        'select method, status, reference from payments where sale_id = $1',
        [saleId],
      )
      expect(rows[0].method).toBe('card')
      expect(rows[0].status).toBe('simulated_approved')
      expect(rows[0].reference).toMatch(/^SIM-/)
    })
  })

  it('el descuento se resta del total sin tocar el desglose de IVA (subtotal/tax vienen del precio de lista)', async () => {
    await withTransaction(async (client) => {
      const appointmentId = await seedCompletedAppointment(client, [
        { serviceId: SERVICE_BANO, quantity: 1 },
      ])

      await setRole(client, 'authenticated', USER_RECEPCION)
      const saleId = await checkout(
        client,
        appointmentId,
        [{ method: 'cash', amount_cents: 20000 }],
        5000,
      )

      const { rows } = await client.query(
        'select subtotal_cents, tax_cents, discount_cents, total_cents from sales where id = $1',
        [saleId],
      )
      expect(rows[0]).toMatchObject({
        subtotal_cents: 21552,
        tax_cents: 3448,
        discount_cents: 5000,
        total_cents: 20000, // 25000 - 5000, igual que lib/money.ts#applyDiscount
      })
    })
  })

  it('el folio es consecutivo POR SUCURSAL, no por tenant: dos sucursales no comparten numeración', async () => {
    await withTransaction(async (client) => {
      const appointmentCentro = await seedCompletedAppointment(
        client,
        [{ serviceId: SERVICE_BANO, quantity: 1 }],
        { branchId: BRANCH_CENTRO, employeeUserId: USER_DUENO },
      )
      const appointmentDelValle = await seedCompletedAppointment(
        client,
        [{ serviceId: SERVICE_BANO, quantity: 1 }],
        { branchId: BRANCH_DEL_VALLE, employeeUserId: USER_DUENO },
      )

      // El dueño ve y cobra en cualquier sucursal (CLAUDE.md §6.1).
      await setRole(client, 'authenticated', USER_DUENO)
      const saleCentroId = await checkout(client, appointmentCentro, [
        { method: 'cash', amount_cents: 25000 },
      ])
      const saleDelValleId = await checkout(client, appointmentDelValle, [
        { method: 'cash', amount_cents: 25000 },
      ])

      const { rows } = await client.query(
        'select branch_id, folio from sales where id in ($1, $2) order by branch_id',
        [saleCentroId, saleDelValleId],
      )
      // No hay ninguna venta previa sembrada en ninguna sucursal (fase 5 es
      // nueva), así que las DOS primeras ventas de sus respectivas
      // sucursales caen en folio 1 — si compartieran numeración, la
      // segunda sería folio 2.
      expect(rows).toEqual([
        { branch_id: BRANCH_CENTRO, folio: 1 },
        { branch_id: BRANCH_DEL_VALLE, folio: 1 },
      ])
    })
  })
})

describe('checkout_appointment(): pago insuficiente (tarea 5.8)', () => {
  it('lanza una excepción y no deja escrita ni la venta ni sus partidas', async () => {
    await withTransaction(async (client) => {
      const appointmentId = await seedCompletedAppointment(client, [
        { serviceId: SERVICE_BANO, quantity: 1 },
      ])

      await setRole(client, 'authenticated', USER_RECEPCION)

      // SAVEPOINT: el error que viene abajo deja la transacción "abortada"
      // hasta que se revierta a este punto — sin esto, cualquier consulta
      // posterior en el mismo cliente fallaría con "current transaction is
      // aborted", aunque el error en sí sea el esperado.
      await client.query('savepoint before_checkout')
      await expect(
        checkout(client, appointmentId, [{ method: 'cash', amount_cents: 1 }]),
      ).rejects.toThrow(/no cubre el total/i)
      await client.query('rollback to savepoint before_checkout')

      const { rows: saleRows } = await client.query(
        'select count(*)::int as count from sales where branch_id = $1',
        [BRANCH_CENTRO],
      )
      expect(saleRows[0].count).toBe(0)

      const { rows: itemRows } = await client.query(
        'select count(*)::int as count from sale_items where appointment_id = $1',
        [appointmentId],
      )
      expect(itemRows[0].count).toBe(0)

      const { rows: paymentRows } = await client.query(
        `select count(*)::int as count from payments p
         join sales s on s.id = p.sale_id
         where s.branch_id = $1`,
        [BRANCH_CENTRO],
      )
      expect(paymentRows[0].count).toBe(0)
    })
  })
})

describe('checkout_appointment(): reglas de negocio', () => {
  it('no se puede cobrar la misma cita dos veces', async () => {
    await withTransaction(async (client) => {
      const appointmentId = await seedCompletedAppointment(client, [
        { serviceId: SERVICE_BANO, quantity: 1 },
      ])

      await setRole(client, 'authenticated', USER_RECEPCION)
      await checkout(client, appointmentId, [{ method: 'cash', amount_cents: 25000 }])

      await client.query('savepoint before_second_checkout')
      await expect(
        checkout(client, appointmentId, [{ method: 'cash', amount_cents: 25000 }]),
      ).rejects.toThrow(/ya fue cobrada/i)
      await client.query('rollback to savepoint before_second_checkout')
    })
  })

  it('no se puede cobrar una cita que todavía no está atendida', async () => {
    await withTransaction(async (client) => {
      const appointmentId = await seedCompletedAppointment(client, [
        { serviceId: SERVICE_BANO, quantity: 1 },
      ])
      await setRole(client, 'service_role')
      await client.query("update appointments set status = 'in_progress' where id = $1", [
        appointmentId,
      ])

      await setRole(client, 'authenticated', USER_RECEPCION)
      await expect(
        checkout(client, appointmentId, [{ method: 'cash', amount_cents: 25000 }]),
      ).rejects.toThrow(/debe estar atendida/i)
    })
  })
})

describe('checkout_appointment(): permisos (tarea 5.9)', () => {
  it('un usuario de OTRO tenant no puede cobrar una cita ajena', async () => {
    await withTransaction(async (client) => {
      const appointmentId = await seedCompletedAppointment(client, [
        { serviceId: SERVICE_BANO, quantity: 1 },
      ])

      // Mismo truco que appointments-rls.spec.ts: no hay personal sembrado
      // en Huellitas Spa (seed.sql), así que se reasigna temporalmente la
      // membresía de un usuario real a ese tenant, DENTRO de la
      // transacción de prueba (se revierte sola al terminar).
      await setRole(client, 'service_role')
      await client.query('update memberships set tenant_id = $1 where user_id = $2', [
        TENANT_HUELLITAS,
        USER_GROOMER,
      ])

      await setRole(client, 'authenticated', USER_GROOMER)
      await expect(
        checkout(client, appointmentId, [{ method: 'cash', amount_cents: 25000 }]),
      ).rejects.toThrow(/no perteneces a este negocio/i)
    })
  })

  it('un rol sin permiso de cobro (groomer) no puede cobrar, aunque sea del mismo tenant y sucursal', async () => {
    // Centro: el groomer SÍ tiene acceso a esta sucursal (seed.sql) — a
    // propósito, para que el rechazo se deba al ROL, no a la sucursal
    // (mismo criterio que appointments-rls.spec.ts).
    await withTransaction(async (client) => {
      const appointmentId = await seedCompletedAppointment(client, [
        { serviceId: SERVICE_BANO, quantity: 1 },
      ])

      await setRole(client, 'authenticated', USER_GROOMER)
      await expect(
        checkout(client, appointmentId, [{ method: 'cash', amount_cents: 25000 }]),
      ).rejects.toThrow(/no tienes permiso para cobrar/i)
    })
  })
})

describe('checkout_appointment(): los totales coinciden con lib/money.ts (tarea 5.10)', () => {
  it('con varias partidas mezcladas, el desglose de la base es EXACTO al de sumLineItems', async () => {
    const lines = [
      { serviceId: SERVICE_BANO, quantity: 2 },
      { serviceId: SERVICE_CORTE_RAZA, quantity: 1 },
    ]

    await withTransaction(async (client) => {
      const appointmentId = await seedCompletedAppointment(client, lines)

      // Los mismos datos que ve el RPC (precio y tasa del catálogo,
      // CLAUDE.md §6.3 — tax_rate_bp no está en el snapshot, se lee de
      // services), calculados del lado de JS con la MISMA función que usa
      // la UI para mostrar el resumen antes de cobrar.
      const { rows: catalog } = await client.query(
        'select id, price_cents, tax_rate_bp from services where id = any($1::uuid[])',
        [lines.map((l) => l.serviceId)],
      )
      const priceByService = new Map(catalog.map((s) => [s.id, s]))
      const expected = sumLineItems(
        lines.map((line) => ({
          unitPriceCents: priceByService.get(line.serviceId)!.price_cents,
          quantity: line.quantity,
          taxRateBp: priceByService.get(line.serviceId)!.tax_rate_bp,
        })),
      )

      await setRole(client, 'authenticated', USER_RECEPCION)
      const saleId = await checkout(client, appointmentId, [
        { method: 'cash', amount_cents: expected.totalCents },
      ])

      const { rows } = await client.query(
        'select subtotal_cents, tax_cents, total_cents from sales where id = $1',
        [saleId],
      )
      expect(rows[0]).toEqual({
        subtotal_cents: expected.subtotalCents,
        tax_cents: expected.taxCents,
        total_cents: expected.totalCents,
      })
    })
  })
})
