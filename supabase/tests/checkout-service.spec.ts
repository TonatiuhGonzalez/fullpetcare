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
