// Prueba services/customers.ts (tarea 2.10) — a diferencia de
// tenancy-isolation.spec.ts, aquí NO se usa pg + simulación de rol
// (supabase/tests/helpers.ts). Se usa el cliente REAL de supabase-js
// (el mismo `supabase` que importa toda la app, vía @/services/supabase)
// con una sesión real iniciada contra la API de Auth local. La
// diferencia importa: helpers.ts prueba el MECANISMO de RLS directo
// contra Postgres; este archivo prueba que las funciones que de verdad
// usa la UI (customers.create, .search, .softDelete...) se comportan
// bien de punta a punta, incluyendo la parte que un test con pg no
// puede ver (que PostgREST rearma bien la fila que Supabase-js espera).
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import pg from 'pg'

import * as customers from '@/services/customers'
import { supabase } from '@/services/supabase'

import { TENANT_PATITAS } from './fixtures'

const DUENO_EMAIL = 'dueno@patitasfelices.mx'
const DUENO_PASSWORD = 'Demo1234!'

// Conexión aparte, SIN pasar por withTransaction()/asServiceRole() de
// helpers.ts: esos envuelven todo en una transacción que termina en
// ROLLBACK a propósito (para que un test nunca deje rastro). Aquí es
// justo lo contrario de lo que se necesita — las filas que se crean en
// este archivo se insertan de verdad, vía la API real (no dentro de una
// transacción de test), así que limpiarlas requiere un DELETE que sí se
// guarde.
const { Pool } = pg
const cleanupPool = new Pool({
  connectionString: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
})

async function hardDeleteCustomers(ids: string[]): Promise<void> {
  if (ids.length === 0) return
  const client = await cleanupPool.connect()
  try {
    // customers no tiene política de DELETE para "authenticated" (a
    // propósito — CLAUDE.md §7.3), así que la limpieza necesita
    // service_role, que sí bypassa RLS.
    await client.query('set role service_role')
    await client.query('delete from customers where id = any($1::uuid[])', [ids])
  } finally {
    await client.query('reset role')
    client.release()
  }
}

afterAll(() => cleanupPool.end())

describe('services/customers.ts contra Supabase local', () => {
  // Cada test agrega aquí los ids que crea, y afterEach los borra de
  // verdad — así un test no deja clientes de prueba acumulándose en la
  // base cada vez que alguien corre "npm run test:db" en su Mac.
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
    await hardDeleteCustomers(createdIds)
    createdIds.length = 0
  })

  it('crea un cliente y lo puede leer de vuelta con getById', async () => {
    // Camino feliz de "create": si esto falla, ninguna alta de cliente
    // desde CustomerFormDialog (tarea 2.17) funcionaría.
    const created = await customers.create({
      tenant_id: TENANT_PATITAS,
      first_name: 'Prueba',
      last_name: 'Automática',
      phone: '5500000000',
    })
    createdIds.push(created.id)

    expect(created.id).toBeTruthy()

    const found = await customers.getById(TENANT_PATITAS, created.id)
    expect(found?.first_name).toBe('Prueba')
    expect(found?.last_name).toBe('Automática')
  })

  it('search encuentra por nombre parcial, sin importar mayúsculas', async () => {
    // "Valentina Cruz Mendoza" está en la semilla (supabase/seed.sql).
    // "val" son solo las primeras letras del nombre — prueba justo el
    // caso "búsqueda mientras escribes" de CustomersPage (tarea 2.16).
    const results = await customers.search(TENANT_PATITAS, 'val')
    expect(results.some((c) => c.first_name === 'Valentina')).toBe(true)
  })

  it('search también encuentra por apellido parcial', async () => {
    // "Cruz" es el apellido de Valentina, no el nombre — confirma que el
    // OR de la consulta (first_name.ilike OR last_name.ilike) de verdad
    // cubre ambos campos, no solo el primero.
    const results = await customers.search(TENANT_PATITAS, 'cruz')
    expect(results.some((c) => c.last_name === 'Cruz Mendoza')).toBe(true)
  })

  it('el borrado suave saca al cliente de list() pero la fila sigue en la base', async () => {
    // Este es el caso que de verdad importa de borrado suave (CLAUDE.md
    // §8.5): que "desaparecer" para la app no signifique "desaparecer"
    // de la base. Si softDelete hiciera un DELETE real, este test lo
    // atraparía (la consulta directa de abajo ya no encontraría la fila).
    const created = await customers.create({
      tenant_id: TENANT_PATITAS,
      first_name: 'Por Borrar',
      last_name: 'De Prueba',
    })
    createdIds.push(created.id)

    await customers.softDelete(created.id)

    const listed = await customers.list(TENANT_PATITAS)
    expect(listed.some((c) => c.id === created.id)).toBe(false)

    const client = await cleanupPool.connect()
    try {
      await client.query('set role service_role')
      const { rows } = await client.query(
        'select deleted_at from customers where id = $1',
        [created.id],
      )
      expect(rows).toHaveLength(1)
      expect(rows[0].deleted_at).not.toBeNull()
    } finally {
      await client.query('reset role')
      client.release()
    }
  })
})
