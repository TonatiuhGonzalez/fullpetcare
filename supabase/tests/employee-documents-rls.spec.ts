// RLS de employee_documents (la TABLA de metadatos) y del bucket de
// Storage "employee-documents" (el ARCHIVO en sí) — fase 9. Dos
// mecanismos distintos, mismo criterio (app.has_permission), así que se
// prueban por separado: la tabla con el helper de pg (transacción que se
// revierte sola, tests-helpers.ts), el archivo con una sesión real de
// supabase-js (igual que storage-rls.spec.ts, porque Storage no vive
// dentro de una transacción de Postgres que un ROLLBACK pueda deshacer).
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import pg from 'pg'
import type { PoolClient } from 'pg'

import { supabase } from '@/services/supabase'
import { closePool, setRole, withTransaction } from './helpers'
import { TENANT_HUELLITAS, TENANT_PATITAS, USER_DUENO, USER_GROOMER } from './fixtures'

afterAll(closePool)

async function seedDocumentRow(client: PoolClient): Promise<string> {
  await setRole(client, 'service_role')
  const { rows: membershipRows } = await client.query(
    'select id from memberships where tenant_id = $1 and user_id = $2',
    [TENANT_PATITAS, USER_DUENO],
  )
  const membershipId = membershipRows[0].id

  const { rows } = await client.query(
    `insert into employee_documents (tenant_id, membership_id, document_type, storage_path, uploaded_by)
     values ($1, $2, 'voter_id', $3, $4)
     returning id`,
    [TENANT_PATITAS, membershipId, `${TENANT_PATITAS}/${membershipId}/voter_id.jpg`, USER_DUENO],
  )
  return rows[0].id
}

describe('employee_documents: tabla de metadatos', () => {
  it('el dueño ve el documento de un empleado de su negocio', async () => {
    await withTransaction(async (client) => {
      const id = await seedDocumentRow(client)

      await setRole(client, 'authenticated', USER_DUENO)
      const { rows } = await client.query('select id from employee_documents where id = $1', [id])
      expect(rows).toHaveLength(1)
    })
  })

  it('un groomer no ve el documento (falta "employees:view")', async () => {
    await withTransaction(async (client) => {
      const id = await seedDocumentRow(client)

      await setRole(client, 'authenticated', USER_GROOMER)
      const { rows } = await client.query('select id from employee_documents where id = $1', [id])
      expect(rows).toHaveLength(0)
    })
  })

  it('aislamiento: un miembro de OTRO tenant no ve el documento', async () => {
    await withTransaction(async (client) => {
      const id = await seedDocumentRow(client)

      await setRole(client, 'service_role')
      await client.query('update memberships set tenant_id = $1, role = $2 where user_id = $3', [
        TENANT_HUELLITAS,
        'owner',
        USER_GROOMER,
      ])

      await setRole(client, 'authenticated', USER_GROOMER)
      const { rows } = await client.query('select id from employee_documents where id = $1', [id])
      expect(rows).toHaveLength(0)
    })
  })
})

describe('employee_documents: unicidad por (empleado, tipo de documento)', () => {
  it('un segundo documento del MISMO tipo para el MISMO empleado se rechaza (se reemplaza con upsert, no se acumula)', async () => {
    await withTransaction(async (client) => {
      await seedDocumentRow(client)

      await setRole(client, 'authenticated', USER_DUENO)
      const { rows: membershipRows } = await client.query(
        'select id from memberships where tenant_id = $1 and user_id = $2',
        [TENANT_PATITAS, USER_DUENO],
      )
      const membershipId = membershipRows[0].id

      await expect(
        client.query(
          `insert into employee_documents (tenant_id, membership_id, document_type, storage_path, uploaded_by)
           values ($1, $2, 'voter_id', $3, $4)`,
          [TENANT_PATITAS, membershipId, `${TENANT_PATITAS}/${membershipId}/voter_id-otro.jpg`, USER_DUENO],
        ),
      ).rejects.toThrow(/duplicate key|unique constraint/i)
    })
  })
})

describe('Aislamiento entre tenants: Storage (employee-documents)', () => {
  const DUENO_EMAIL = 'dueno@patitasfelices.mx'
  const DUENO_PASSWORD = 'Demo1234!'
  const GROOMER_EMAIL = 'groomer@patitasfelices.mx'
  const GROOMER_PASSWORD = 'Demo1234!'

  // service_role key fija del Supabase LOCAL — igual que storage-rls.spec.ts.
  const adminClient = createClient(
    'http://127.0.0.1:54321',
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU',
  )

  const { Pool } = pg
  const cleanupPool = new Pool({
    connectionString: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
  })

  async function reassignGroomerTenant(tenantId: string): Promise<void> {
    const client = await cleanupPool.connect()
    try {
      await client.query('set role service_role')
      await client.query('update memberships set tenant_id = $1 where user_id = $2', [
        tenantId,
        USER_GROOMER,
      ])
    } finally {
      await client.query('reset role')
      client.release()
    }
  }

  const TEST_PATH = `${TENANT_PATITAS}/empleado-de-prueba/voter_id.jpg`

  beforeAll(async () => {
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: DUENO_EMAIL,
      password: DUENO_PASSWORD,
    })
    if (signInError) throw signInError

    const fakeFile = new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/jpeg' })
    const { error: uploadError } = await supabase.storage
      .from('employee-documents')
      .upload(TEST_PATH, fakeFile, { upsert: true })
    if (uploadError) throw uploadError

    await supabase.auth.signOut()
  })

  afterEach(async () => {
    await supabase.auth.signOut()
    await reassignGroomerTenant(TENANT_PATITAS)
  })

  afterAll(async () => {
    await adminClient.storage.from('employee-documents').remove([TEST_PATH])
    await cleanupPool.end()
  })

  it('un miembro de OTRO tenant no puede leer el documento, aunque conozca la ruta exacta', async () => {
    await reassignGroomerTenant(TENANT_HUELLITAS)

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: GROOMER_EMAIL,
      password: GROOMER_PASSWORD,
    })
    if (signInError) throw signInError

    const { data, error } = await supabase.storage.from('employee-documents').download(TEST_PATH)

    expect(data).toBeNull()
    expect(error).not.toBeNull()
  })

  it('un groomer del MISMO tenant tampoco puede leerlo (le falta "employees:view", no es un tema de tenant)', async () => {
    // A diferencia de pet-photos (donde cualquier colega ve las fotos),
    // aquí el permiso es por MÓDULO, no solo por pertenecer al negocio —
    // este caso confirma que el bloqueo de arriba es por permiso, no
    // "cualquier groomer nunca puede leer nada de Storage".
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: GROOMER_EMAIL,
      password: GROOMER_PASSWORD,
    })
    if (signInError) throw signInError

    const { data, error } = await supabase.storage.from('employee-documents').download(TEST_PATH)

    expect(data).toBeNull()
    expect(error).not.toBeNull()
  })

  it('control: el dueño SÍ puede leer el documento', async () => {
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: DUENO_EMAIL,
      password: DUENO_PASSWORD,
    })
    if (signInError) throw signInError

    const { data, error } = await supabase.storage.from('employee-documents').download(TEST_PATH)

    expect(error).toBeNull()
    expect(data).not.toBeNull()
  })
})
