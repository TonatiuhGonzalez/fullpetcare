// Prueba services/vaccines.ts (catálogo) — sesión real. Sin test propio
// hasta ahora (revisión de cobertura, tarea 8.2): vaccines-rls.spec.ts
// prueba la política de la TABLA con `pg`, pero nunca ejercitó la
// función de servicio en sí — en particular, el filtro "de esta especie
// O sin especie" (`listForSpecies`), que es la única lógica real que
// tiene este archivo.
import { describe, expect, it } from 'vitest'

import * as vaccinesService from '@/services/vaccines'
import { supabase } from '@/services/supabase'

import { TENANT_PATITAS, VACCINE_BORDETELLA, VACCINE_RABIA, VACCINE_SEXTUPLE_CANINA } from './fixtures'

const DUENO_EMAIL = 'dueno@patitasfelices.mx'
const DUENO_PASSWORD = 'Demo1234!'

describe('services/vaccines.ts contra Supabase local', () => {
  it('listForSpecies: para un perro trae las de perro Y las de cualquier especie, nunca las de gato', async () => {
    const { error } = await supabase.auth.signInWithPassword({
      email: DUENO_EMAIL,
      password: DUENO_PASSWORD,
    })
    if (error) throw error

    const vaccines = await vaccinesService.listForSpecies(TENANT_PATITAS, 'dog')
    const ids = vaccines.map((v) => v.id)

    // Rabia y Bordetella son "species: null" en el seed (aplican a
    // cualquiera); Séxtuple canina es específica de perro. Las tres
    // deben aparecer.
    expect(ids).toEqual(
      expect.arrayContaining([VACCINE_RABIA, VACCINE_BORDETELLA, VACCINE_SEXTUPLE_CANINA]),
    )
    // Y ninguna vacuna devuelta debe ser exclusiva de otra especie.
    for (const vaccine of vaccines) {
      expect(vaccine.species === null || vaccine.species === 'dog').toBe(true)
    }

    await supabase.auth.signOut()
  })

  it('listForSpecies: para un gato NO trae "Séxtuple canina" (exclusiva de perro)', async () => {
    const { error } = await supabase.auth.signInWithPassword({
      email: DUENO_EMAIL,
      password: DUENO_PASSWORD,
    })
    if (error) throw error

    const vaccines = await vaccinesService.listForSpecies(TENANT_PATITAS, 'cat')
    const ids = vaccines.map((v) => v.id)

    expect(ids).not.toContain(VACCINE_SEXTUPLE_CANINA)
    expect(ids).toEqual(expect.arrayContaining([VACCINE_RABIA, VACCINE_BORDETELLA]))

    await supabase.auth.signOut()
  })
})
