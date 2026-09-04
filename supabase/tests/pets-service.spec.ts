// Prueba services/pets.ts (tarea 2.13) — mismo patrón que
// customers-service.spec.ts: sesión real vía supabase.auth
// signInWithPassword, no pg + simulación de rol. Ver el comentario largo
// en ese archivo para el porqué.
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import pg from 'pg'

import * as pets from '@/services/pets'
import { supabase } from '@/services/supabase'

import { CUSTOMER_SOFIA, PET_ROCKY, TENANT_PATITAS } from './fixtures'

const DUENO_EMAIL = 'dueno@patitasfelices.mx'
const DUENO_PASSWORD = 'Demo1234!'

const { Pool } = pg
const cleanupPool = new Pool({
  connectionString: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
})

async function hardDelete(table: 'pets' | 'pet_weights', ids: string[]): Promise<void> {
  if (ids.length === 0) return
  const client = await cleanupPool.connect()
  try {
    await client.query('set role service_role')
    await client.query(`delete from ${table} where id = any($1::uuid[])`, [ids])
  } finally {
    await client.query('reset role')
    client.release()
  }
}

afterAll(() => cleanupPool.end())

describe('services/pets.ts contra Supabase local', () => {
  const createdPetIds: string[] = []
  const createdWeightIds: string[] = []

  beforeEach(async () => {
    const { error } = await supabase.auth.signInWithPassword({
      email: DUENO_EMAIL,
      password: DUENO_PASSWORD,
    })
    if (error) throw error
  })

  afterEach(async () => {
    await supabase.auth.signOut()
    await hardDelete('pet_weights', createdWeightIds)
    await hardDelete('pets', createdPetIds)
    createdPetIds.length = 0
    createdWeightIds.length = 0
  })

  it('crea una mascota y la puede leer de vuelta con getById', async () => {
    const created = await pets.create({
      tenant_id: TENANT_PATITAS,
      customer_id: CUSTOMER_SOFIA,
      name: 'Prueba',
      species: 'dog',
    })
    createdPetIds.push(created.id)

    const found = await pets.getById(TENANT_PATITAS, created.id)
    expect(found?.name).toBe('Prueba')
    expect(found?.species).toBe('dog')
  })

  it('listByCustomer trae solo las mascotas de ese cliente', async () => {
    // Sofía (CUSTOMER_SOFIA) tiene a Rocky y a Michi en la semilla — si
    // este método trajera TODAS las mascotas del tenant en vez de
    // filtrar por cliente, cualquier otra mascota se colaría aquí.
    const found = await pets.listByCustomer(TENANT_PATITAS, CUSTOMER_SOFIA)
    expect(found.map((p) => p.name).sort()).toEqual(['Michi', 'Rocky'])
  })

  it('addWeight agrega un peso y listWeights lo trae primero (más reciente)', async () => {
    // Rocky ya tiene 2 pesos de la semilla (90 y 30 días atrás). Uno
    // nuevo, medido "ahora", debe aparecer PRIMERO en la lista — prueba
    // que el orden es por measured_at descendente, no por fecha de
    // inserción ni alfabético.
    const added = await pets.addWeight(TENANT_PATITAS, PET_ROCKY, 30100)
    createdWeightIds.push(added.id)

    const history = await pets.listWeights(TENANT_PATITAS, PET_ROCKY)
    expect(history[0].id).toBe(added.id)
    expect(history[0].weight_grams).toBe(30100)
    expect(history.length).toBeGreaterThanOrEqual(3)
  })

  it('el borrado suave saca a la mascota de list() pero la fila sigue en la base', async () => {
    const created = await pets.create({
      tenant_id: TENANT_PATITAS,
      customer_id: CUSTOMER_SOFIA,
      name: 'Por Borrar',
      species: 'cat',
    })
    createdPetIds.push(created.id)

    await pets.softDelete(created.id)

    const listed = await pets.list(TENANT_PATITAS)
    expect(listed.some((p) => p.id === created.id)).toBe(false)

    const client = await cleanupPool.connect()
    try {
      await client.query('set role service_role')
      const { rows } = await client.query('select deleted_at from pets where id = $1', [
        created.id,
      ])
      expect(rows).toHaveLength(1)
      expect(rows[0].deleted_at).not.toBeNull()
    } finally {
      await client.query('reset role')
      client.release()
    }
  })
})
