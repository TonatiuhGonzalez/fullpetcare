// Prueba createWalkIn() de services/appointments.ts y la función de base de
// datos que llama, create_walk_in_appointment (migración
// `walk_in_appointments.sql`, tarea #1969: visitas sin cita). Sesión real,
// mismo patrón que appointments-service.spec.ts.
//
// La semilla no trae citas para "hoy", así que las visitas "ahora" de
// aquí no chocan con datos de ejemplo. Cada test limpia lo que creó.
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import pg from 'pg'

import * as appointmentsService from '@/services/appointments'
import { supabase } from '@/services/supabase'

import {
  BRANCH_CENTRO,
  CUSTOMER_SOFIA,
  PET_ROCKY,
  SERVICE_BANO,
  TENANT_PATITAS,
  USER_GROOMER,
} from './fixtures'

const PASSWORD = 'Demo1234!'

const { Pool } = pg
const cleanupPool = new Pool({
  connectionString: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
})

async function hardDeleteAppointments(ids: string[]): Promise<void> {
  if (ids.length === 0) return
  const client = await cleanupPool.connect()
  try {
    await client.query('set role service_role')
    await client.query('delete from appointment_services where appointment_id = any($1::uuid[])', [
      ids,
    ])
    await client.query('delete from appointments where id = any($1::uuid[])', [ids])
  } finally {
    await client.query('reset role')
    client.release()
  }
}

async function signInAs(email: string): Promise<void> {
  const { error } = await supabase.auth.signInWithPassword({ email, password: PASSWORD })
  if (error) throw error
}

/** Una visita de Baño (60 min) para el groomer, empezando `offsetMinutes` desde ahora. */
function walkInArgs(offsetMinutes: number, extra: { isUrgent?: boolean } = {}) {
  const startsAt = new Date(Date.now() + offsetMinutes * 60_000)
  return {
    tenantId: TENANT_PATITAS,
    branchId: BRANCH_CENTRO,
    customerId: CUSTOMER_SOFIA,
    petId: PET_ROCKY,
    kind: 'grooming' as const,
    employeeUserId: USER_GROOMER,
    startsAt,
    endsAt: new Date(startsAt.getTime() + 60 * 60_000),
    services: [{ serviceId: SERVICE_BANO }],
    ...extra,
  }
}

afterAll(() => cleanupPool.end())

describe('services/appointments.ts createWalkIn() contra Supabase local', () => {
  const createdIds: string[] = []

  afterEach(async () => {
    await supabase.auth.signOut()
    await hardDeleteAppointments(createdIds)
    createdIds.length = 0
  })

  it('una visita que empieza ya queda en curso y marcada como sin cita', async () => {
    // El caso principal: alguien llega y se atiende en ese momento. Si la
    // cita quedara "agendada", recepción tendría que abrirla y pasarla a
    // "en curso" a mano por cada visita, justo lo que este flujo quiere evitar.
    await signInAs('recepcion@patitasfelices.mx')

    const appointment = await appointmentsService.createWalkIn(walkInArgs(0))
    createdIds.push(appointment.id)

    expect(appointment.is_walk_in).toBe(true)
    expect(appointment.is_urgent).toBe(false)
    expect(appointment.status).toBe('in_progress')

    // Y como cualquier cita, lleva sus servicios con snapshot (se cobra igual).
    const [serviceLine] = await appointmentsService.listServices(appointment.id)
    expect(serviceLine.name_snapshot).toBe('Baño')
  })

  it('una visita que empieza más tarde (el cliente espera) queda agendada', async () => {
    // Si el empleado está ocupado y el cliente decide esperar, la cita no
    // puede figurar "en curso" una hora antes de empezar: la agenda le
    // mostraría al groomer una mascota que todavía no está siendo atendida.
    await signInAs('recepcion@patitasfelices.mx')

    const appointment = await appointmentsService.createWalkIn(walkInArgs(45))
    createdIds.push(appointment.id)

    expect(appointment.is_walk_in).toBe(true)
    expect(appointment.status).toBe('scheduled')
  })

  it('puede marcarse como urgente', async () => {
    // is_urgent es lo que pinta la marca de emergencia en la agenda. Si no
    // se guardara, una emergencia se vería igual que un baño de rutina.
    await signInAs('recepcion@patitasfelices.mx')

    const appointment = await appointmentsService.createWalkIn(walkInArgs(0, { isUrgent: true }))
    createdIds.push(appointment.id)

    expect(appointment.is_urgent).toBe(true)
  })

  it('respeta el traslape de horario del empleado, igual que una cita normal', async () => {
    // La visita sin cita reutiliza create_appointment(). Si se saltara esa
    // validación, se podrían encimar dos mascotas a la misma persona por
    // el solo hecho de que la segunda "llegó sin cita".
    await signInAs('recepcion@patitasfelices.mx')

    const first = await appointmentsService.createWalkIn(walkInArgs(0))
    createdIds.push(first.id)

    await expect(appointmentsService.createWalkIn(walkInArgs(10))).rejects.toThrow(
      /ya tiene una cita/i,
    )
  })

  it('rechaza una visita que empieza mucho antes de ahora', async () => {
    // Un walk-in es "llegó ahora". Sin este límite, la función serviría
    // para registrar citas del pasado saltándose el flujo normal.
    await signInAs('recepcion@patitasfelices.mx')

    await expect(appointmentsService.createWalkIn(walkInArgs(-180))).rejects.toThrow(
      /empezar ahora o más tarde/i,
    )
  })

  it('un groomer no puede registrar visitas sin cita', async () => {
    // Registrar llegadas es tarea de recepción/dueño (CLAUDE.md §6.1), igual
    // que agendar. Sin esto, cualquier empleado con sesión podría llamar a
    // la función directo desde la consola del navegador.
    await signInAs('groomer@patitasfelices.mx')

    await expect(appointmentsService.createWalkIn(walkInArgs(0))).rejects.toThrow(
      /No tienes permiso/i,
    )
  })

  it('sin sesión no se puede llamar a la función', async () => {
    // Regla dura de CLAUDE.md §7.3: `anon` no ejecuta nada. Es la puerta
    // más expuesta si alguien descubre el nombre de la función.
    await supabase.auth.signOut()

    await expect(appointmentsService.createWalkIn(walkInArgs(0))).rejects.toThrow()
  })

  it('una cita agendada normal NO queda marcada como sin cita', async () => {
    // Caso de control: las citas de siempre deben seguir con is_walk_in en
    // false (el default de la migración). Si no, toda la agenda se llenaría
    // de marcas de "sin cita".
    await signInAs('recepcion@patitasfelices.mx')

    const appointment = await appointmentsService.create({
      ...walkInArgs(0),
      startsAt: new Date('2027-04-01T15:00:00Z'),
      endsAt: new Date('2027-04-01T16:00:00Z'),
    })
    createdIds.push(appointment.id)

    expect(appointment.is_walk_in).toBe(false)
    expect(appointment.is_urgent).toBe(false)
    expect(appointment.status).toBe('scheduled')
  })
})
