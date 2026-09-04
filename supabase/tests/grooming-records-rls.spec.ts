// RLS de grooming_records (tarea 4.1). A diferencia de medical_records,
// aquí receptionist SÍ puede leer (CLAUDE.md §6.1) — pero vet queda
// fuera, mismo criterio de "cada rol ve su propio dominio".
import { afterAll, describe, expect, it } from 'vitest'

import { closePool, setRole, withTransaction } from './helpers'
import {
  BRANCH_CENTRO,
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

async function seedGroomingRecord(
  client: Parameters<typeof setRole>[0],
): Promise<{ appointmentId: string; recordId: string }> {
  await setRole(client, 'service_role')
  const { rows: appt } = await client.query(
    `insert into appointments (tenant_id, branch_id, customer_id, pet_id, kind, employee_user_id, starts_at, ends_at, created_by)
     values ($1, $2, $3, $4, 'grooming', $5, now() + interval '3 days', now() + interval '3 days' + interval '1 hour', $6)
     returning id`,
    [TENANT_PATITAS, BRANCH_CENTRO, CUSTOMER_SOFIA, PET_ROCKY, USER_GROOMER, USER_DUENO],
  )
  const appointmentId = appt[0].id

  const { rows: record } = await client.query(
    `insert into grooming_records (tenant_id, appointment_id, pet_id, cut_style)
     values ($1, $2, $3, 'Corte de verano')
     returning id`,
    [TENANT_PATITAS, appointmentId, PET_ROCKY],
  )
  return { appointmentId, recordId: record[0].id }
}

describe('grooming_records: lectura para owner, receptionist y groomer', () => {
  it('vet del MISMO tenant recibe cero filas', async () => {
    await withTransaction(async (client) => {
      const { recordId } = await seedGroomingRecord(client)

      await setRole(client, 'authenticated', USER_VET)
      const { rows } = await client.query('select id from grooming_records where id = $1', [
        recordId,
      ])

      expect(rows).toHaveLength(0)
    })
  })

  it('control: recepción SÍ puede leer la ficha de estética', async () => {
    await withTransaction(async (client) => {
      const { recordId } = await seedGroomingRecord(client)

      await setRole(client, 'authenticated', USER_RECEPCION)
      const { rows } = await client.query('select id from grooming_records where id = $1', [
        recordId,
      ])

      expect(rows).toHaveLength(1)
    })
  })

  it('control: el dueño ve cualquier ficha de estética de su tenant', async () => {
    // setRole sobre el MISMO client (no asUser(), que abriría otra
    // transacción/conexión y no vería la fila todavía sin confirmar).
    await withTransaction(async (client) => {
      const { recordId } = await seedGroomingRecord(client)

      await setRole(client, 'authenticated', USER_DUENO)
      const { rows } = await client.query('select id from grooming_records where id = $1', [
        recordId,
      ])

      expect(rows).toHaveLength(1)
    })
  })
})

describe('grooming_records: aislamiento entre tenants', () => {
  it('un miembro de otro tenant no ve la ficha, aunque tenga rol groomer ahí', async () => {
    await withTransaction(async (client) => {
      const { recordId } = await seedGroomingRecord(client)

      await setRole(client, 'service_role')
      await client.query('update memberships set tenant_id = $1 where user_id = $2', [
        TENANT_HUELLITAS,
        USER_VET,
      ])
      await client.query("update memberships set role = 'groomer' where user_id = $1", [
        USER_VET,
      ])

      await setRole(client, 'authenticated', USER_VET)
      const { rows } = await client.query('select id from grooming_records where id = $1', [
        recordId,
      ])

      expect(rows).toHaveLength(0)
    })
  })
})

describe('grooming_records: quién puede escribir', () => {
  it('recepción no puede crear una ficha de estética (no la atiende)', async () => {
    await withTransaction(async (client) => {
      await setRole(client, 'service_role')
      const { rows: appt } = await client.query(
        `insert into appointments (tenant_id, branch_id, customer_id, pet_id, kind, employee_user_id, starts_at, ends_at, created_by)
         values ($1, $2, $3, $4, 'grooming', $5, now() + interval '4 days', now() + interval '4 days' + interval '1 hour', $6)
         returning id`,
        [TENANT_PATITAS, BRANCH_CENTRO, CUSTOMER_SOFIA, PET_ROCKY, USER_GROOMER, USER_DUENO],
      )

      await setRole(client, 'authenticated', USER_RECEPCION)
      await expect(
        client.query(
          `insert into grooming_records (tenant_id, appointment_id, pet_id)
           values ($1, $2, $3)`,
          [TENANT_PATITAS, appt[0].id, PET_ROCKY],
        ),
      ).rejects.toThrow(/row-level security/i)
    })
  })

  it('el groomer asignado a la cita SÍ puede crear y actualizar su ficha', async () => {
    await withTransaction(async (client) => {
      await setRole(client, 'service_role')
      const { rows: appt } = await client.query(
        `insert into appointments (tenant_id, branch_id, customer_id, pet_id, kind, employee_user_id, starts_at, ends_at, created_by)
         values ($1, $2, $3, $4, 'grooming', $5, now() + interval '8 days', now() + interval '8 days' + interval '1 hour', $6)
         returning id`,
        [TENANT_PATITAS, BRANCH_CENTRO, CUSTOMER_SOFIA, PET_ROCKY, USER_GROOMER, USER_DUENO],
      )

      await setRole(client, 'authenticated', USER_GROOMER)
      const { rows: record } = await client.query(
        `insert into grooming_records (tenant_id, appointment_id, pet_id, cut_style)
         values ($1, $2, $3, 'Corte deportivo') returning id`,
        [TENANT_PATITAS, appt[0].id, PET_ROCKY],
      )
      expect(record).toHaveLength(1)

      const updateResult = await client.query(
        "update grooming_records set behavior_notes = 'Tranquilo' where id = $1",
        [record[0].id],
      )
      expect(updateResult.rowCount).toBe(1)
    })
  })
})
