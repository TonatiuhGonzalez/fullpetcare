// Prueba services/appointments.ts (tareas 3.11 y 3.12) — sesión real,
// mismo patrón que customers-service.spec.ts. create()/reschedule()
// llaman a las funciones create_appointment/reschedule_appointment
// (migración appointment_booking_rpc.sql), así que estos tests también
// prueban esas funciones de punta a punta.
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import pg from 'pg'

import * as appointmentsService from '@/services/appointments'
import { supabase } from '@/services/supabase'

import { futureDateAtUtc, WEEKDAY } from './schedule-dates'
import {
  BRANCH_CENTRO,
  CUSTOMER_SOFIA,
  PET_ROCKY,
  SERVICE_BANO,
  TENANT_PATITAS,
  USER_GROOMER,
} from './fixtures'

const DUENO_EMAIL = 'dueno@patitasfelices.mx'
const DUENO_PASSWORD = 'Demo1234!'

const { Pool } = pg
const cleanupPool = new Pool({
  connectionString: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
})

async function hardDeleteAppointments(ids: string[]): Promise<void> {
  if (ids.length === 0) return
  const client = await cleanupPool.connect()
  try {
    await client.query('set role service_role')
    // appointment_services primero: tiene una FK hacia appointments.
    await client.query('delete from appointment_services where appointment_id = any($1::uuid[])', [
      ids,
    ])
    await client.query('delete from appointments where id = any($1::uuid[])', [ids])
  } finally {
    await client.query('reset role')
    client.release()
  }
}

afterAll(() => cleanupPool.end())

describe('services/appointments.ts contra Supabase local', () => {
  const createdIds: string[] = []

  afterEach(async () => {
    await supabase.auth.signOut()
    await hardDeleteAppointments(createdIds)
    createdIds.length = 0
  })

  it('crear una cita copia nombre/precio/duración del servicio (snapshot)', async () => {
    // El caso clave de la tarea 3.11: si mañana sube el precio del
    // Baño, esta cita YA agendada debe conservar el precio de hoy — un
    // ticket histórico nunca cambia de monto (CLAUDE.md §6.3).
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: DUENO_EMAIL,
      password: DUENO_PASSWORD,
    })
    if (signInError) throw signInError

    const appointment = await appointmentsService.create({
      tenantId: TENANT_PATITAS,
      branchId: BRANCH_CENTRO,
      customerId: CUSTOMER_SOFIA,
      petId: PET_ROCKY,
      kind: 'grooming',
      employeeUserId: USER_GROOMER,
      startsAt: futureDateAtUtc(WEEKDAY.wednesday, 15),
      endsAt: futureDateAtUtc(WEEKDAY.wednesday, 16),
      services: [{ serviceId: SERVICE_BANO }],
    })
    createdIds.push(appointment.id)

    const [serviceLine] = await appointmentsService.listServices(appointment.id)
    expect(serviceLine.name_snapshot).toBe('Baño')
    expect(serviceLine.unit_price_cents).toBe(25000)
    expect(serviceLine.duration_minutes_snapshot).toBe(60)

    // Sube el precio del catálogo DESPUÉS de agendar...
    const admin = await cleanupPool.connect()
    try {
      await admin.query('set role service_role')
      await admin.query('update services set price_cents = 99999 where id = $1', [SERVICE_BANO])

      // ...y el snapshot de la cita ya agendada NO cambia.
      const { rows } = await admin.query(
        'select unit_price_cents from appointment_services where appointment_id = $1',
        [appointment.id],
      )
      expect(rows[0].unit_price_cents).toBe(25000)

      // Se revierte el precio para no afectar otros tests/la demo.
      await admin.query('update services set price_cents = 25000 where id = $1', [SERVICE_BANO])
    } finally {
      await admin.query('reset role')
      admin.release()
    }
  })

  it('SÍ se puede crear una cita que se encime con otra del mismo empleado (D26)', async () => {
    // Cambió de sentido en Correcciones 1: antes la base rechazaba el
    // traslape con "ya tiene una cita". Ahora es un aviso de la interfaz; si
    // la base siguiera rechazando, el aviso fallaría al guardar.
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: DUENO_EMAIL,
      password: DUENO_PASSWORD,
    })
    if (signInError) throw signInError

    const first = await appointmentsService.create({
      tenantId: TENANT_PATITAS,
      branchId: BRANCH_CENTRO,
      customerId: CUSTOMER_SOFIA,
      petId: PET_ROCKY,
      kind: 'grooming',
      employeeUserId: USER_GROOMER,
      startsAt: futureDateAtUtc(WEEKDAY.thursday, 15),
      endsAt: futureDateAtUtc(WEEKDAY.thursday, 16),
      services: [{ serviceId: SERVICE_BANO }],
    })
    createdIds.push(first.id)

    // Se traslapa a la mitad (15:30-16:30 se cruza con 15:00-16:00).
    const second = await appointmentsService.create({
      tenantId: TENANT_PATITAS,
      branchId: BRANCH_CENTRO,
      customerId: CUSTOMER_SOFIA,
      petId: PET_ROCKY,
      kind: 'grooming',
      employeeUserId: USER_GROOMER,
      startsAt: futureDateAtUtc(WEEKDAY.thursday, 15, 30),
      endsAt: futureDateAtUtc(WEEKDAY.thursday, 16, 30),
      services: [{ serviceId: SERVICE_BANO }],
    })
    createdIds.push(second.id)

    expect(second.id).not.toBe(first.id)
  })

  it('rechaza una cita en el pasado con un mensaje en español', async () => {
    // La base decide (no el reloj del navegador): una llamada directa a la
    // API tampoco puede agendar en el pasado.
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: DUENO_EMAIL,
      password: DUENO_PASSWORD,
    })
    if (signInError) throw signInError

    await expect(
      appointmentsService.create({
        tenantId: TENANT_PATITAS,
        branchId: BRANCH_CENTRO,
        customerId: CUSTOMER_SOFIA,
        petId: PET_ROCKY,
        kind: 'grooming',
        employeeUserId: USER_GROOMER,
        startsAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
        endsAt: new Date(Date.now() - 23 * 60 * 60 * 1000),
        services: [{ serviceId: SERVICE_BANO }],
      }),
    ).rejects.toThrow(/ya pasó/i)
  })

  it('una cita que EMPIEZA justo cuando otra TERMINA sí se puede crear', async () => {
    // Caso de control del anterior: los extremos no se traslapan (mismo
    // criterio que lib/availability.ts).
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: DUENO_EMAIL,
      password: DUENO_PASSWORD,
    })
    if (signInError) throw signInError

    const first = await appointmentsService.create({
      tenantId: TENANT_PATITAS,
      branchId: BRANCH_CENTRO,
      customerId: CUSTOMER_SOFIA,
      petId: PET_ROCKY,
      kind: 'grooming',
      employeeUserId: USER_GROOMER,
      startsAt: futureDateAtUtc(WEEKDAY.friday, 15),
      endsAt: futureDateAtUtc(WEEKDAY.friday, 16),
      services: [{ serviceId: SERVICE_BANO }],
    })
    createdIds.push(first.id)

    const second = await appointmentsService.create({
      tenantId: TENANT_PATITAS,
      branchId: BRANCH_CENTRO,
      customerId: CUSTOMER_SOFIA,
      petId: PET_ROCKY,
      kind: 'grooming',
      employeeUserId: USER_GROOMER,
      startsAt: futureDateAtUtc(WEEKDAY.friday, 16),
      endsAt: futureDateAtUtc(WEEKDAY.friday, 17),
      services: [{ serviceId: SERVICE_BANO }],
    })
    createdIds.push(second.id)

    expect(second.id).toBeTruthy()
  })
})
