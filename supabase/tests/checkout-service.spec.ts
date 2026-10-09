// Prueba services/checkout.ts contra Supabase local — sesión real, mismo
// patrón que appointments-service.spec.ts. La lógica de negocio del cobro
// (todo o nada, permisos, folio) ya está probada a fondo en
// checkout-rpc.spec.ts contra la función de Postgres directo; esto prueba
// la CAPA DE SERVICIO: que buildSummary() arma el mismo desglose que
// terminará guardado, que charge() manda los parámetros en la forma que
// espera el RPC, y que getTicket() junta venta + partidas + pagos con los
// nombres correctos para TicketView (tarea 5.15).
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import pg from 'pg'

import * as appointmentsService from '@/services/appointments'
import * as checkoutService from '@/services/checkout'
import { supabase } from '@/services/supabase'
import { sumLineItems } from '@/lib/money'

import { BRANCH_CENTRO, CUSTOMER_SOFIA, PET_ROCKY, SERVICE_BANO, TENANT_PATITAS, USER_GROOMER } from './fixtures'

const DUENO_EMAIL = 'dueno@patitasfelices.mx'
const DUENO_PASSWORD = 'Demo1234!'

const { Pool } = pg
const cleanupPool = new Pool({
  connectionString: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
})

// A diferencia del expediente clínico, una venta de prueba SÍ se puede
// borrar físicamente: sales/sale_items/payments no llevan
// prevent_hard_delete() (CLAUDE.md §8.5 solo lo exige para grooming/
// medical records y vaccinations, que son documentos legales — un ticket
// de prueba no lo es).
async function hardDeleteAppointment(appointmentId: string): Promise<void> {
  const client = await cleanupPool.connect()
  try {
    await client.query('set role service_role')

    const { rows: saleRows } = await client.query(
      'select sale_id from sale_items where appointment_id = $1',
      [appointmentId],
    )
    const saleIds: string[] = saleRows.map((r) => r.sale_id)

    // Orden que respeta las foreign keys: payments y sale_items apuntan a
    // sales, así que se borran ANTES que la venta misma.
    if (saleIds.length > 0) {
      await client.query('delete from payments where sale_id = any($1::uuid[])', [saleIds])
    }
    await client.query('delete from sale_items where appointment_id = $1', [appointmentId])
    if (saleIds.length > 0) {
      await client.query('delete from sales where id = any($1::uuid[])', [saleIds])
    }
    await client.query('delete from appointment_services where appointment_id = $1', [
      appointmentId,
    ])
    await client.query('delete from appointments where id = $1', [appointmentId])
  } finally {
    await client.query('reset role')
    client.release()
  }
}

afterAll(() => cleanupPool.end())

describe('services/checkout.ts contra Supabase local', () => {
  const createdAppointmentIds: string[] = []

  afterEach(async () => {
    await supabase.auth.signOut()
    for (const id of createdAppointmentIds) {
      await hardDeleteAppointment(id)
    }
    createdAppointmentIds.length = 0
  })

  // Cada test agenda en un DÍA distinto (mismo empleado): si la limpieza
  // de un test anterior fallara, el traslape de horarios no tumbaría en
  // cascada al resto de los tests con un error que no tiene nada que ver
  // con lo que se está probando.
  let nextDayOffset = 1

  async function createAttendedAppointment(): Promise<string> {
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: DUENO_EMAIL,
      password: DUENO_PASSWORD,
    })
    if (signInError) throw signInError

    const day = nextDayOffset++
    const appointment = await appointmentsService.create({
      tenantId: TENANT_PATITAS,
      branchId: BRANCH_CENTRO,
      customerId: CUSTOMER_SOFIA,
      petId: PET_ROCKY,
      kind: 'grooming',
      employeeUserId: USER_GROOMER,
      startsAt: new Date(`2027-04-${String(day).padStart(2, '0')}T15:00:00Z`),
      endsAt: new Date(`2027-04-${String(day).padStart(2, '0')}T16:00:00Z`),
      services: [{ serviceId: SERVICE_BANO, quantity: 2 }],
    })
    createdAppointmentIds.push(appointment.id)

    // El flujo real pasa por AttendPage (fase 4); aquí basta reproducir
    // sus dos pasos de estado para llegar a 'completed', que es lo que
    // checkout_appointment() exige.
    await appointmentsService.changeStatus(TENANT_PATITAS, appointment.id, 'in_progress')
    await appointmentsService.changeStatus(TENANT_PATITAS, appointment.id, 'completed')

    return appointment.id
  }

  it('buildSummary() arma el mismo desglose que sumLineItems() con los datos de la cita', async () => {
    const appointmentId = await createAttendedAppointment()

    const summary = await checkoutService.buildSummary(appointmentId)

    expect(summary.lineItems).toEqual([
      {
        serviceId: SERVICE_BANO,
        description: 'Baño',
        quantity: 2,
        unitPriceCents: 25000,
        taxRateBp: 1600,
      },
    ])
    const expected = sumLineItems(summary.lineItems)
    expect(summary.subtotalCents).toBe(expected.subtotalCents)
    expect(summary.taxCents).toBe(expected.taxCents)
    expect(summary.discountCents).toBe(0)
    expect(summary.totalCents).toBe(expected.totalCents)
  })

  it('buildSummary() aplica el descuento al total, no al subtotal ni al IVA', async () => {
    const appointmentId = await createAttendedAppointment()

    const summary = await checkoutService.buildSummary(appointmentId, 5000)

    expect(summary.discountCents).toBe(5000)
    expect(summary.totalCents).toBe(summary.subtotalCents + summary.taxCents - 5000)
  })

  it('charge() cobra la cita y devuelve un ticket con venta, partidas y pagos', async () => {
    const appointmentId = await createAttendedAppointment()
    const summary = await checkoutService.buildSummary(appointmentId)

    const ticket = await checkoutService.charge({
      appointmentId,
      payments: [{ method: 'cash', amountCents: summary.totalCents }],
    })

    expect(ticket.sale.status).toBe('paid')
    expect(ticket.sale.total_cents).toBe(summary.totalCents)
    expect(ticket.customerName).toBe('Sofía Ramírez Castillo')
    expect(ticket.branchName).toBe('Sucursal Centro')
    expect(ticket.items).toHaveLength(1)
    expect(ticket.items[0].appointment_id).toBe(appointmentId)
    expect(ticket.payments).toEqual([
      expect.objectContaining({ method: 'cash', amount_cents: summary.totalCents, status: 'approved' }),
    ])
  })

  it('getTicket() recupera el mismo ticket después, por id de venta', async () => {
    const appointmentId = await createAttendedAppointment()
    const summary = await checkoutService.buildSummary(appointmentId)
    const original = await checkoutService.charge({
      appointmentId,
      payments: [{ method: 'cash', amountCents: summary.totalCents }],
    })

    const fetched = await checkoutService.getTicket(original.sale.id)

    expect(fetched.sale.id).toBe(original.sale.id)
    expect(fetched.items).toHaveLength(1)
    expect(fetched.payments).toHaveLength(1)
  })
})

// "Últimos vendidos" del punto de venta (fase 13, 13G). Se insertan ventas directo con
// service_role (el cobro ya está probado arriba y en checkout-products-rpc.spec.ts); lo que
// se prueba aquí es la consulta: orden, sucursal y ventas canceladas.
describe('listRecentlySoldProductIds (últimos vendidos del punto de venta)', () => {
  const PRODUCT_ALIMENTO = '20000000-0000-4000-8000-000000000001'
  const PRODUCT_SHAMPOO = '20000000-0000-4000-8000-000000000002'
  const BRANCH_DEL_VALLE = 'c0000000-0000-4000-8000-000000000002'
  const createdSaleIds: string[] = []

  async function insertSale(
    status: 'paid' | 'cancelled',
    branchId: string,
    paidAt: string,
    productId: string,
  ): Promise<void> {
    const client = await cleanupPool.connect()
    try {
      await client.query('set role service_role')
      // Folio alto para no chocar con los de las ventas reales de otros tests.
      const folio = 900000 + createdSaleIds.length + Math.floor(Math.random() * 90000)
      const { rows } = await client.query(
        `insert into sales (tenant_id, branch_id, folio, status, paid_at)
         values ($1, $2, $3, $4, $5) returning id`,
        [TENANT_PATITAS, branchId, folio, status, paidAt],
      )
      createdSaleIds.push(rows[0].id)
      await client.query(
        `insert into sale_items (tenant_id, sale_id, item_type, product_id, description,
                                 quantity, unit_price_cents, tax_rate_bp, tax_cents, line_total_cents)
         values ($1, $2, 'product', $3, 'Producto de prueba', 1, 1000, 1600, 138, 1000)`,
        [TENANT_PATITAS, rows[0].id, productId],
      )
    } finally {
      client.release()
    }
  }

  afterEach(async () => {
    const client = await cleanupPool.connect()
    try {
      await client.query('set role service_role')
      for (const id of createdSaleIds.splice(0)) {
        await client.query('delete from sale_items where sale_id = $1', [id])
        await client.query('delete from sales where id = $1', [id])
      }
    } finally {
      client.release()
    }
  })

  async function signInAsOwner(): Promise<void> {
    const { error } = await supabase.auth.signInWithPassword({
      email: DUENO_EMAIL,
      password: DUENO_PASSWORD,
    })
    if (error) throw error
  }

  it('devuelve los productos de la venta más reciente primero', async () => {
    // Qué se rompería: la fila "Últimos vendidos" mostraría lo vendido hace semanas arriba
    // de lo que se acaba de vender.
    await insertSale('paid', BRANCH_CENTRO, '2026-01-01T10:00:00Z', PRODUCT_ALIMENTO)
    await insertSale('paid', BRANCH_CENTRO, '2026-01-02T10:00:00Z', PRODUCT_SHAMPOO)
    await signInAsOwner()

    const ids = await checkoutService.listRecentlySoldProductIds(TENANT_PATITAS, BRANCH_CENTRO)

    expect(ids.slice(0, 2)).toEqual([PRODUCT_SHAMPOO, PRODUCT_ALIMENTO])
  })

  it('no cuenta las ventas canceladas ni las de otra sucursal', async () => {
    // Qué se rompería: se ofrecería como "reciente" un producto cuya venta se canceló, o uno
    // que solo se vende en otra sucursal (donde quizá ni hay existencia).
    await insertSale('cancelled', BRANCH_CENTRO, '2026-02-01T10:00:00Z', PRODUCT_ALIMENTO)
    await insertSale('paid', BRANCH_DEL_VALLE, '2026-02-02T10:00:00Z', PRODUCT_SHAMPOO)
    await signInAsOwner()

    const ids = await checkoutService.listRecentlySoldProductIds(TENANT_PATITAS, BRANCH_CENTRO)

    expect(ids).toEqual([])
  })
})
