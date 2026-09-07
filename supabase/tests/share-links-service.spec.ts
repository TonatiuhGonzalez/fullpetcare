// Prueba services/shareLinks.ts (tarea 7.3) — sesión real, mismo patrón
// que pets-service.spec.ts. share_links SÍ se puede borrar de verdad (no
// es expediente clínico), así que la limpieza usa un DELETE normal.
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import pg from 'pg'

import * as shareLinks from '@/services/shareLinks'
import { supabase } from '@/services/supabase'

import { PET_ROCKY, TENANT_PATITAS, USER_DUENO } from './fixtures'

const DUENO_EMAIL = 'dueno@patitasfelices.mx'
const DUENO_PASSWORD = 'Demo1234!'

const { Pool } = pg
const cleanupPool = new Pool({
  connectionString: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
})

async function hardDeleteShareLinks(ids: string[]): Promise<void> {
  if (ids.length === 0) return
  const client = await cleanupPool.connect()
  try {
    await client.query('set role service_role')
    await client.query('delete from share_links where id = any($1::uuid[])', [ids])
  } finally {
    await client.query('reset role')
    client.release()
  }
}

/** Lee la fila TAL CUAL quedó en la base, sin pasar por RLS ni por el tipo `ShareLink`. */
async function rawRow(id: string): Promise<{ token_hash: string; revoked_at: string | null }> {
  const client = await cleanupPool.connect()
  try {
    await client.query('set role service_role')
    const { rows } = await client.query(
      'select token_hash, revoked_at from share_links where id = $1',
      [id],
    )
    return rows[0]
  } finally {
    await client.query('reset role')
    client.release()
  }
}

afterAll(() => cleanupPool.end())

describe('services/shareLinks.ts contra Supabase local', () => {
  const createdIds: string[] = []

  beforeEach(async () => {
    const { error } = await supabase.auth.signInWithPassword({
      email: DUENO_EMAIL,
      password: DUENO_PASSWORD,
    })
    if (error) throw error
  })

  afterEach(async () => {
    await supabase.auth.signOut()
    await hardDeleteShareLinks(createdIds)
    createdIds.length = 0
  })

  it('dos tokens nunca se repiten', async () => {
    const first = await shareLinks.createForPet(TENANT_PATITAS, PET_ROCKY, USER_DUENO)
    const second = await shareLinks.createForPet(TENANT_PATITAS, PET_ROCKY, USER_DUENO)
    createdIds.push(first.record.id, second.record.id)

    expect(first.token).not.toBe(second.token)
    expect(first.record.token_hash).not.toBe(second.record.token_hash)
  })

  it('en la base no queda el token en claro — solo su hash', async () => {
    const { token, record } = await shareLinks.createForPet(TENANT_PATITAS, PET_ROCKY, USER_DUENO)
    createdIds.push(record.id)

    const row = await rawRow(record.id)
    // El hash NUNCA es igual al token (ni un prefijo/sufijo de él): son
    // valores sin relación reconstruible entre sí, esa es justo la
    // garantía de un hash de un solo sentido.
    expect(row.token_hash).not.toBe(token)
    expect(row.token_hash).not.toContain(token)
    // Sí se guarda un PREFIJO corto del token en claro (para identificar
    // el link en una lista, tarea 7.14) — eso es intencional, no una fuga:
    // 8 caracteres de 43 no alcanzan para reconstruir el token completo.
    expect(token.startsWith(record.token_prefix)).toBe(true)
  })

  it('revocar un link le pone revoked_at, sin borrar la fila', async () => {
    const { record } = await shareLinks.createForPet(TENANT_PATITAS, PET_ROCKY, USER_DUENO)
    createdIds.push(record.id)

    const before = await rawRow(record.id)
    expect(before.revoked_at).toBeNull()

    await shareLinks.revoke(record.id)

    const after = await rawRow(record.id)
    expect(after.revoked_at).not.toBeNull()
  })

  it('listByPet trae los links de esa mascota, más reciente primero', async () => {
    const first = await shareLinks.createForPet(TENANT_PATITAS, PET_ROCKY, USER_DUENO)
    const second = await shareLinks.createForPet(TENANT_PATITAS, PET_ROCKY, USER_DUENO)
    createdIds.push(first.record.id, second.record.id)

    const list = await shareLinks.listByPet(TENANT_PATITAS, PET_ROCKY)
    const ids = list.map((l) => l.id)
    expect(ids.indexOf(second.record.id)).toBeLessThan(ids.indexOf(first.record.id))
  })
})
