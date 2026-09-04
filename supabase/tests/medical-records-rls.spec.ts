// El test más importante de la fase 4 (tarea 4.3): que un groomer NUNCA
// pueda leer el expediente clínico, aunque comparta tenant con quien sí
// puede. Se prueba contra Postgres real, no con un `v-if` en la UI.
//
// =============================================================================
// Por qué esto se prueba en la base y no confiando en la UI
// =============================================================================
// Sería fácil "resolver" esto en el frontend: simplemente no mostrar el
// botón de expediente clínico si `session.role !== 'vet' && session.role
// !== 'owner'`. El problema es que eso solo esconde el botón — no
// impide que alguien llame a la API directo (con las herramientas de
// desarrollador del navegador, o un script) pidiendo `medical_records`
// sin pasar por ningún componente de Vue. Un `v-if` es una decisión de
// PRESENTACIÓN; quien de verdad decide qué datos viajan por la red tiene
// que ser la base de datos — por eso la política vive en RLS
// (CLAUDE.md §7.1) y este test la ataca directo con `pg`, como si la UI
// no existiera.
import { afterAll, describe, expect, it } from 'vitest'

import { closePool, setRole, withTransaction } from './helpers'
import {
  BRANCH_DEL_VALLE,
  CUSTOMER_SOFIA,
  PET_ROCKY,
  TENANT_HUELLITAS,
  TENANT_PATITAS,
  USER_DUENO,
  USER_GROOMER,
  USER_RECEPCION,
  USER_VET,
} from './fixtures'

afterAll(closePool)

// Crea una cita veterinaria + su expediente, como service_role, dentro
// de la transacción del test (nunca se guarda de verdad).
async function seedMedicalRecord(
  client: Parameters<typeof setRole>[0],
): Promise<{ appointmentId: string; recordId: string }> {
  await setRole(client, 'service_role')
  const { rows: appt } = await client.query(
    `insert into appointments (tenant_id, branch_id, customer_id, pet_id, kind, employee_user_id, starts_at, ends_at, created_by)
     values ($1, $2, $3, $4, 'veterinary', $5, now() + interval '5 days', now() + interval '5 days' + interval '30 minutes', $6)
     returning id`,
    [TENANT_PATITAS, BRANCH_DEL_VALLE, CUSTOMER_SOFIA, PET_ROCKY, USER_VET, USER_DUENO],
  )
  const appointmentId = appt[0].id

  const { rows: record } = await client.query(
    `insert into medical_records (tenant_id, appointment_id, pet_id, reason, diagnosis)
     values ($1, $2, $3, 'Revisión de rutina', 'Sano')
     returning id`,
    [TENANT_PATITAS, appointmentId, PET_ROCKY],
  )
  return { appointmentId, recordId: record[0].id }
}

describe('medical_records: solo owner y vet pueden leerlo', () => {
  it('un groomer del MISMO tenant recibe cero filas', async () => {
    await withTransaction(async (client) => {
      const { recordId } = await seedMedicalRecord(client)

      await setRole(client, 'authenticated', USER_GROOMER)
      const { rows } = await client.query('select id from medical_records where id = $1', [
        recordId,
      ])

      expect(rows).toHaveLength(0)
    })
  })

  it('recepción tampoco lo ve, aunque sí ve grooming_records', async () => {
    // Distinto de grooming_records a propósito (CLAUDE.md §6.1):
    // receptionist SÍ puede leer la ficha de estética (necesita
    // consultarla al cobrar), pero el expediente clínico es
    // exclusivamente owner/vet.
    await withTransaction(async (client) => {
      const { recordId } = await seedMedicalRecord(client)

      await setRole(client, 'authenticated', USER_RECEPCION)
      const { rows } = await client.query('select id from medical_records where id = $1', [
        recordId,
      ])

      expect(rows).toHaveLength(0)
    })
  })

  it('control: el vet asignado a la cita SÍ ve su propio expediente', async () => {
    await withTransaction(async (client) => {
      const { recordId } = await seedMedicalRecord(client)

      await setRole(client, 'authenticated', USER_VET)
      const { rows } = await client.query('select id from medical_records where id = $1', [
        recordId,
      ])

      expect(rows).toHaveLength(1)
    })
  })

  it('control: el dueño ve cualquier expediente de su tenant', async () => {
    // setRole sobre el MISMO client, no asUser() (que abre su propia
    // transacción/conexión aparte): el expediente sembrado arriba
    // todavía no está confirmado (vive dentro de esta transacción, que
    // se revierte al final), así que una conexión distinta no vería
    // nada — no por RLS, sino por aislamiento normal de transacciones.
    await withTransaction(async (client) => {
      const { recordId } = await seedMedicalRecord(client)

      await setRole(client, 'authenticated', USER_DUENO)
      const { rows } = await client.query('select id from medical_records where id = $1', [
        recordId,
      ])

      expect(rows).toHaveLength(1)
    })
  })
})

describe('medical_records: aislamiento entre tenants', () => {
  it('un miembro de otro tenant no ve el expediente, aunque tenga rol vet ahí', async () => {
    await withTransaction(async (client) => {
      const { recordId } = await seedMedicalRecord(client)

      await setRole(client, 'service_role')
      await client.query('update memberships set tenant_id = $1, role = $2 where user_id = $3', [
        TENANT_HUELLITAS,
        'vet',
        USER_GROOMER,
      ])

      await setRole(client, 'authenticated', USER_GROOMER)
      const { rows } = await client.query('select id from medical_records where id = $1', [
        recordId,
      ])

      expect(rows).toHaveLength(0)
    })
  })
})

describe('medical_records: quién puede escribir', () => {
  it('un groomer no puede insertar un expediente clínico', async () => {
    await withTransaction(async (client) => {
      await setRole(client, 'service_role')
      const { rows: appt } = await client.query(
        `insert into appointments (tenant_id, branch_id, customer_id, pet_id, kind, employee_user_id, starts_at, ends_at, created_by)
         values ($1, $2, $3, $4, 'veterinary', $5, now() + interval '6 days', now() + interval '6 days' + interval '30 minutes', $6)
         returning id`,
        [TENANT_PATITAS, BRANCH_DEL_VALLE, CUSTOMER_SOFIA, PET_ROCKY, USER_VET, USER_DUENO],
      )

      await setRole(client, 'authenticated', USER_GROOMER)
      await expect(
        client.query(
          `insert into medical_records (tenant_id, appointment_id, pet_id, reason)
           values ($1, $2, $3, 'no debería crearse')`,
          [TENANT_PATITAS, appt[0].id, PET_ROCKY],
        ),
      ).rejects.toThrow(/row-level security/i)
    })
  })

  it('el vet asignado a la cita SÍ puede crear y actualizar su expediente', async () => {
    await withTransaction(async (client) => {
      await setRole(client, 'service_role')
      const { rows: appt } = await client.query(
        `insert into appointments (tenant_id, branch_id, customer_id, pet_id, kind, employee_user_id, starts_at, ends_at, created_by)
         values ($1, $2, $3, $4, 'veterinary', $5, now() + interval '7 days', now() + interval '7 days' + interval '30 minutes', $6)
         returning id`,
        [TENANT_PATITAS, BRANCH_DEL_VALLE, CUSTOMER_SOFIA, PET_ROCKY, USER_VET, USER_DUENO],
      )

      await setRole(client, 'authenticated', USER_VET)
      const { rows: record } = await client.query(
        `insert into medical_records (tenant_id, appointment_id, pet_id, reason)
         values ($1, $2, $3, 'Consulta') returning id`,
        [TENANT_PATITAS, appt[0].id, PET_ROCKY],
      )
      expect(record).toHaveLength(1)

      const updateResult = await client.query(
        "update medical_records set diagnosis = 'Sano' where id = $1",
        [record[0].id],
      )
      expect(updateResult.rowCount).toBe(1)
    })
  })
})
