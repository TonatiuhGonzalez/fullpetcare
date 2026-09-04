// Prueba services/services.ts (tarea 3.9) — sesión real, mismo patrón
// que customers-service.spec.ts.
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import pg from 'pg'

import * as servicesService from '@/services/services'
import { supabase } from '@/services/supabase'

import { TENANT_PATITAS } from './fixtures'

const DUENO_EMAIL = 'dueno@patitasfelices.mx'
const DUENO_PASSWORD = 'Demo1234!'
const RECEPCION_EMAIL = 'recepcion@patitasfelices.mx'
const RECEPCION_PASSWORD = 'Demo1234!'

const { Pool } = pg
const cleanupPool = new Pool({
  connectionString: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
})

async function hardDeleteServices(ids: string[]): Promise<void> {
  if (ids.length === 0) return
  const client = await cleanupPool.connect()
  try {
    await client.query('set role service_role')
    await client.query('delete from services where id = any($1::uuid[])', [ids])
  } finally {
    await client.query('reset role')
    client.release()
  }
}

afterAll(() => cleanupPool.end())

describe('services/services.ts contra Supabase local', () => {
  const createdIds: string[] = []

  afterEach(async () => {
    await supabase.auth.signOut()
    await hardDeleteServices(createdIds)
    createdIds.length = 0
  })

  it('el dueño puede dar de alta un servicio nuevo', async () => {
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: DUENO_EMAIL,
      password: DUENO_PASSWORD,
    })
    if (signInError) throw signInError

    const created = await servicesService.create({
      tenant_id: TENANT_PATITAS,
      kind: 'grooming',
      name: 'Servicio de prueba',
      duration_minutes: 45,
      price_cents: 30000,
      tax_rate_bp: 1600,
    })
    createdIds.push(created.id)

    expect(created.name).toBe('Servicio de prueba')
  })

  it('recepción NO puede dar de alta un servicio (es configuración del negocio, solo owner)', async () => {
    // CLAUDE.md §6.1 no le da esto a receptionist — a diferencia de
    // clientes/mascotas, el catálogo es exclusivo del dueño.
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: RECEPCION_EMAIL,
      password: RECEPCION_PASSWORD,
    })
    if (signInError) throw signInError

    await expect(
      servicesService.create({
        tenant_id: TENANT_PATITAS,
        kind: 'grooming',
        name: 'No debería crearse',
        duration_minutes: 30,
        price_cents: 10000,
        tax_rate_bp: 1600,
      }),
    ).rejects.toThrow()
  })

  it('listByKind separa estética de veterinaria', async () => {
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: DUENO_EMAIL,
      password: DUENO_PASSWORD,
    })
    if (signInError) throw signInError

    const grooming = await servicesService.listByKind(TENANT_PATITAS, 'grooming')
    const veterinary = await servicesService.listByKind(TENANT_PATITAS, 'veterinary')

    expect(grooming.every((s) => s.kind === 'grooming')).toBe(true)
    expect(veterinary.every((s) => s.kind === 'veterinary')).toBe(true)
    expect(grooming.some((s) => s.name === 'Baño')).toBe(true)
    expect(veterinary.some((s) => s.name === 'Consulta general')).toBe(true)
  })

  it('deactivate apaga is_active pero el servicio sigue en listByKind', async () => {
    // "Desactivar" no es borrar (CLAUDE.md, migración services.sql): las
    // citas viejas que usaron este servicio necesitan que siga
    // existiendo, solo ya no se ofrece para agendar una cita nueva.
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: DUENO_EMAIL,
      password: DUENO_PASSWORD,
    })
    if (signInError) throw signInError

    const created = await servicesService.create({
      tenant_id: TENANT_PATITAS,
      kind: 'veterinary',
      name: 'Servicio a desactivar',
      duration_minutes: 20,
      price_cents: 15000,
      tax_rate_bp: 1600,
    })
    createdIds.push(created.id)

    await servicesService.deactivate(created.id)

    const list = await servicesService.listByKind(TENANT_PATITAS, 'veterinary')
    const found = list.find((s) => s.id === created.id)
    expect(found).toBeDefined()
    expect(found?.is_active).toBe(false)
  })
})
