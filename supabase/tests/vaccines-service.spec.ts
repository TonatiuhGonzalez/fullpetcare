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

describe('services/vaccines.ts: editar el catálogo (fase 26)', () => {
  const VET_EMAIL = 'vet@patitasfelices.mx'
  const GROOMER_EMAIL = 'groomer@patitasfelices.mx'

  async function signIn(email: string): Promise<void> {
    const { error } = await supabase.auth.signInWithPassword({ email, password: DUENO_PASSWORD })
    if (error) throw error
  }

  it('el veterinario crea, edita y oculta una vacuna; al ocultarla sale de las listas', async () => {
    // Recorre el ciclo completo con sesión real. Qué se rompería: la pantalla de Vacunas
    // guardaría pero la vacuna seguiría ofreciéndose al registrar una dosis (o al revés).
    await signIn(VET_EMAIL)

    const created = await vaccinesService.create(TENANT_PATITAS, {
      name: '  Vacuna de prueba 26  ',
      species: 'cat',
      default_interval_days: 365,
    })
    expect(created.name).toBe('Vacuna de prueba 26') // sin espacios sobrantes

    const updated = await vaccinesService.update(created.id, {
      name: 'Vacuna de prueba 26',
      species: null,
      default_interval_days: null,
    })
    expect(updated.species).toBeNull()
    expect(updated.default_interval_days).toBeNull()

    expect((await vaccinesService.listAll(TENANT_PATITAS)).map((v) => v.id)).toContain(created.id)

    await vaccinesService.hide(created.id)

    expect((await vaccinesService.listAll(TENANT_PATITAS)).map((v) => v.id)).not.toContain(
      created.id,
    )
    expect(
      (await vaccinesService.listForSpecies(TENANT_PATITAS, 'cat')).map((v) => v.id),
    ).not.toContain(created.id)

    await supabase.auth.signOut()
  })

  it('un groomer no puede crear una vacuna: la base lo rechaza', async () => {
    // La pantalla no le ofrece el botón, pero la regla real es la política RLS.
    await signIn(GROOMER_EMAIL)

    await expect(
      vaccinesService.create(TENANT_PATITAS, {
        name: 'No debería existir',
        species: null,
        default_interval_days: null,
      }),
    ).rejects.toMatchObject({ code: '42501' })

    await supabase.auth.signOut()
  })
})
