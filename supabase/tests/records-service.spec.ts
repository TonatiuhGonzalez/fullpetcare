// Prueba services/records.ts (tarea 4.10) contra Supabase local — mismo
// patrón que appointments-service.spec.ts: sesión real de un usuario
// (no un mock de Supabase), porque lo que se prueba aquí no es solo "el
// insert llega" sino que la política RLS del rol correcto (groomer para
// su ficha, vet para la suya) deja pasar la escritura.
//
// También verifica la bitácora (audit_log, CLAUDE.md §8.6): guardar una
// ficha o aplicar una vacuna debe dejar un rastro de quién lo hizo. Sin
// esa prueba, un trigger roto (o borrado sin querer en una migración
// futura) pasaría inadvertido hasta que alguien lo necesitara de verdad
// — por ejemplo, para una disputa legal sobre qué diagnóstico se dio.
//
// UNA COSA IMPORTANTE DE LIMPIEZA: a diferencia de appointments-service.spec.ts,
// aquí NO se puede hacer un DELETE al terminar cada test. grooming_records,
// medical_records y vaccinations son expediente (CLAUDE.md §8.5): tienen un
// trigger `prevent_hard_delete()` que rechaza cualquier DELETE, incluso con
// service_role — es la protección "ni siquiera un admin puede borrar un
// expediente por accidente". Y como la cita queda referenciada por esos
// registros (sin ON DELETE CASCADE), tampoco se puede borrar LA CITA de
// prueba una vez que tiene una ficha guardada. Los tests que sí guardan una
// ficha dejan, a propósito, una cita y un registro de prueba permanentes en
// tu base local — igual que pasaría en producción. `npm run db:reset`
// limpia todo eso cuando quieras una base local otra vez limpia.
import { afterAll, describe, expect, it } from 'vitest'
import pg from 'pg'

import * as recordsService from '@/services/records'
import { supabase } from '@/services/supabase'

import {
  BRANCH_CENTRO,
  BRANCH_DEL_VALLE,
  CUSTOMER_SOFIA,
  PET_ROCKY,
  TENANT_PATITAS,
  USER_DUENO,
  USER_GROOMER,
  USER_VET,
  VACCINE_RABIA,
} from './fixtures'

const GROOMER_EMAIL = 'groomer@patitasfelices.mx'
const VET_EMAIL = 'vet@patitasfelices.mx'
const DEMO_PASSWORD = 'Demo1234!'

const { Pool } = pg
const adminPool = new Pool({
  connectionString: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
})

async function withAdmin<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await adminPool.connect()
  try {
    await client.query('set role service_role')
    return await fn(client)
  } finally {
    await client.query('reset role')
    client.release()
  }
}

/**
 * Crea una cita de prueba directo en la base, sin pasar por el RPC (no
 * hace falta para estos tests). `branchId` importa de verdad: la
 * política de `medical_records`/`grooming_records` valida "¿esta cita es
 * de auth.uid()?" con un SELECT sobre `appointments`, y ese SELECT
 * también pasa por RLS — si el empleado no tiene acceso a la sucursal de
 * la cita (`membership_branches`, seed.sql), esa subconsulta no ve la
 * fila y el INSERT del expediente se rechaza aunque sí sea SU cita.
 */
async function createAppointment(
  kind: 'grooming' | 'veterinary',
  employeeUserId: string,
  branchId: string,
): Promise<string> {
  return withAdmin(async (client) => {
    const { rows } = await client.query(
      `insert into appointments (tenant_id, branch_id, customer_id, pet_id, kind, employee_user_id, starts_at, ends_at, created_by)
       values ($1, $2, $3, $4, $5, $6, now() + interval '5 days', now() + interval '5 days' + interval '1 hour', $7)
       returning id`,
      [TENANT_PATITAS, branchId, CUSTOMER_SOFIA, PET_ROCKY, kind, employeeUserId, USER_DUENO],
    )
    return rows[0].id as string
  })
}

afterAll(() => adminPool.end())

describe('services/records.ts contra Supabase local', () => {
  it('el groomer asignado guarda la ficha de estética, y guardarla dos veces actualiza (no duplica)', async () => {
    const appointmentId = await createAppointment('grooming', USER_GROOMER, BRANCH_CENTRO)

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: GROOMER_EMAIL,
      password: DEMO_PASSWORD,
    })
    if (signInError) throw signInError

    const first = await recordsService.saveGroomingRecord({
      tenantId: TENANT_PATITAS,
      appointmentId,
      petId: PET_ROCKY,
      cutStyle: 'Corte de verano',
    })

    const second = await recordsService.saveGroomingRecord({
      tenantId: TENANT_PATITAS,
      appointmentId,
      petId: PET_ROCKY,
      cutStyle: 'Corte de verano',
      behaviorNotes: 'Tranquilo, se dejó bañar sin problema',
    })

    // Mismo id: el segundo guardado actualizó el registro, no creó uno nuevo.
    expect(second.id).toBe(first.id)
    expect(second.behavior_notes).toBe('Tranquilo, se dejó bañar sin problema')

    // La bitácora debe tener un INSERT y un UPDATE, ambos hechos por el
    // groomer que abrió la sesión (no por "alguien", el actor real).
    const { rows: auditRows } = await withAdmin((client) =>
      client.query(
        `select action, actor_user_id from audit_log
         where table_name = 'grooming_records' and record_id = $1
         order by changed_at`,
        [first.id],
      ),
    )
    expect(auditRows.map((r) => r.action)).toEqual(['INSERT', 'UPDATE'])
    expect(auditRows.every((r) => r.actor_user_id === USER_GROOMER)).toBe(true)

    await supabase.auth.signOut()
  })

  it('un vet no puede guardar la ficha de una cita de estética que no es suya', async () => {
    const appointmentId = await createAppointment('grooming', USER_GROOMER, BRANCH_CENTRO)

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: VET_EMAIL,
      password: DEMO_PASSWORD,
    })
    if (signInError) throw signInError

    await expect(
      recordsService.saveGroomingRecord({
        tenantId: TENANT_PATITAS,
        appointmentId,
        petId: PET_ROCKY,
        cutStyle: 'Intento ajeno',
      }),
    ).rejects.toThrow()

    await supabase.auth.signOut()

    // Aquí SÍ se puede borrar: la escritura falló, así que no quedó ningún
    // grooming_record apuntando a esta cita — nada de expediente que proteger.
    await withAdmin((client) => client.query('delete from appointments where id = $1', [appointmentId]))
  })

  it('el vet asignado guarda la ficha médica con temperatura y próxima visita', async () => {
    const appointmentId = await createAppointment('veterinary', USER_VET, BRANCH_DEL_VALLE)

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: VET_EMAIL,
      password: DEMO_PASSWORD,
    })
    if (signInError) throw signInError

    const record = await recordsService.saveMedicalRecord({
      tenantId: TENANT_PATITAS,
      appointmentId,
      petId: PET_ROCKY,
      reason: 'Revisión anual',
      diagnosis: 'Sano',
      temperatureDeciC: 385, // 38.5 °C — entero en décimas (CLAUDE.md §6.2)
      nextVisitDate: '2027-06-01',
    })

    expect(record.temperature_deci_c).toBe(385)
    expect(record.next_visit_date).toBe('2027-06-01')

    const found = await recordsService.getMedicalRecordByAppointment(appointmentId)
    expect(found?.id).toBe(record.id)

    await supabase.auth.signOut()
  })

  it('aplicar la misma vacuna dos veces crea DOS filas (cada dosis es un hecho propio)', async () => {
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: VET_EMAIL,
      password: DEMO_PASSWORD,
    })
    if (signInError) throw signInError

    const first = await recordsService.addVaccination({
      tenantId: TENANT_PATITAS,
      petId: PET_ROCKY,
      vaccineId: VACCINE_RABIA,
      appliedByUserId: USER_VET,
      appliedAt: '2026-01-01T12:00:00Z',
      nextDueDate: '2027-01-01',
    })

    const second = await recordsService.addVaccination({
      tenantId: TENANT_PATITAS,
      petId: PET_ROCKY,
      vaccineId: VACCINE_RABIA,
      appliedByUserId: USER_VET,
      appliedAt: '2027-01-01T12:00:00Z',
      nextDueDate: '2028-01-01',
    })

    expect(second.id).not.toBe(first.id)

    const history = await recordsService.listVaccinationsByPet(TENANT_PATITAS, PET_ROCKY)
    const ids = history.map((v) => v.id)
    expect(ids).toContain(first.id)
    expect(ids).toContain(second.id)
    // La más reciente va primero.
    expect(ids.indexOf(second.id)).toBeLessThan(ids.indexOf(first.id))

    await supabase.auth.signOut()
  })
})
