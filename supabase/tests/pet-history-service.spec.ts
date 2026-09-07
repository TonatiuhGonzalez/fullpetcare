// Prueba services/petHistory.ts (tarea 6.2, la mitad que necesita datos
// reales — la mitad pura vive en src/lib/timeline.spec.ts). Sesión real de
// supabase-js, mismo patrón que customers-service.spec.ts: se prueba que
// getTimeline() se comporta bien de punta a punta, no solo que RLS
// mecánicamente filtra filas.
import { afterAll, describe, expect, it } from 'vitest'
import pg from 'pg'

import * as petHistory from '@/services/petHistory'
import { supabase } from '@/services/supabase'

import {
  BRANCH_TIJUANA,
  PET_BRUNO,
  PET_MICHI,
  TENANT_HUELLITAS,
  TENANT_PATITAS,
  USER_DUENO,
} from './fixtures'

const DUENO_EMAIL = 'dueno@patitasfelices.mx'
const DUENO_PASSWORD = 'Demo1234!'

const { Pool } = pg
const cleanupPool = new Pool({
  connectionString: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
})

afterAll(() => cleanupPool.end())

describe('services/petHistory.ts contra Supabase local', () => {
  it('una mascota sin ninguna visita, vacuna ni pesada da una lista vacía', async () => {
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: DUENO_EMAIL,
      password: DUENO_PASSWORD,
    })
    if (signInError) throw signInError

    // Michi (seed.sql) no tiene ni una fila en appointments, vaccinations
    // ni pet_weights — es justo el caso "mascota nueva, recién dada de
    // alta" de la tarea 6.2.
    const timeline = await petHistory.getTimeline(TENANT_PATITAS, PET_MICHI)

    expect(timeline).toEqual([])
    await supabase.auth.signOut()
  })

  it('no aparecen eventos de una mascota de OTRO tenant, aunque se pida su tenant_id correcto', async () => {
    // Bruno es de Huellitas Spa, que no tiene personal sembrado (seed.sql)
    // — se le arma a mano, como service_role, una visita completada y una
    // pesada para tener algo real que NO debería cruzar hacia Patitas.
    const admin = await cleanupPool.connect()
    let appointmentId = ''
    try {
      await admin.query('set role service_role')
      const { rows } = await admin.query(
        `insert into appointments (tenant_id, branch_id, customer_id, pet_id, kind, employee_user_id, starts_at, ends_at, status, created_by)
         select $1, $2, customer_id, $3, 'grooming', $4, now() - interval '1 day', now() - interval '1 day' + interval '30 minutes', 'completed', $4
         from pets where id = $3
         returning id`,
        [TENANT_HUELLITAS, BRANCH_TIJUANA, PET_BRUNO, USER_DUENO],
      )
      appointmentId = rows[0].id
      await admin.query(
        `insert into grooming_records (tenant_id, appointment_id, pet_id, cut_style)
         values ($1, $2, $3, 'Cachorro')`,
        [TENANT_HUELLITAS, appointmentId, PET_BRUNO],
      )
      await admin.query(
        `insert into pet_weights (tenant_id, pet_id, weight_grams)
         values ($1, $2, 6000)`,
        [TENANT_HUELLITAS, PET_BRUNO],
      )

      // Caso de control: la fila SÍ existe (si no, un "no aparece nada"
      // de abajo sería un falso positivo por no haber sembrado nada).
      const { rows: controlRows } = await admin.query(
        'select count(*)::int as count from grooming_records where appointment_id = $1',
        [appointmentId],
      )
      expect(controlRows[0].count).toBe(1)

      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: DUENO_EMAIL,
        password: DUENO_PASSWORD,
      })
      if (signInError) throw signInError

      // El dueño de Patitas Felices no tiene membresía en Huellitas Spa
      // (seed.sql) — aunque se le pida SU tenant_id "correcto" para Bruno,
      // RLS (no un filtro de la app) es quien de verdad bloquea esto.
      const timeline = await petHistory.getTimeline(TENANT_HUELLITAS, PET_BRUNO)
      expect(timeline).toEqual([])
      await supabase.auth.signOut()
    } finally {
      // grooming_records (y la appointments que le apunta con una FK) NO
      // se pueden borrar ni siquiera como service_role — el trigger
      // app.prevent_hard_delete() lo impide a propósito (CLAUDE.md §8.5,
      // probado en soft-delete.spec.ts): es un expediente, no un dato de
      // prueba desechable. Mismo criterio que records-service.spec.ts
      // (tarea 4.11): se deja permanente, `npm run db:reset` la limpia.
      // pet_weights sí se puede borrar de verdad.
      await admin.query('delete from pet_weights where pet_id = $1 and weight_grams = 6000', [
        PET_BRUNO,
      ])
      await admin.query('reset role')
      admin.release()
    }
  })
})
