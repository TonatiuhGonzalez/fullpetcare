// Prueba services/species.ts y services/breeds.ts con sesión real (fase 27, tarea 27.7):
// el ciclo que recorre la pantalla "Especies y razas".
import { afterEach, describe, expect, it } from 'vitest'

import * as breedsService from '@/services/breeds'
import * as speciesService from '@/services/species'
import { supabase } from '@/services/supabase'

import { TENANT_PATITAS } from './fixtures'

const PASSWORD = 'Demo1234!'

async function signIn(email: string): Promise<void> {
  const { error } = await supabase.auth.signInWithPassword({ email, password: PASSWORD })
  if (error) throw error
}

afterEach(async () => {
  await supabase.auth.signOut()
})

describe('services/species.ts y breeds.ts contra Supabase local', () => {
  // Qué prueba: que el veterinario crea una especie y una raza, las edita y las oculta, y
  // que al ocultarlas salen de las listas. Qué se rompería: la pantalla guardaría pero el
  // formulario de mascota seguiría ofreciendo (o nunca ofrecería) lo que se acaba de editar.
  it('el veterinario crea, edita y oculta una especie y una raza', async () => {
    await signIn('vet@patitasfelices.mx')

    const groups = await speciesService.listGroups(TENANT_PATITAS)
    expect(groups.length).toBeGreaterThanOrEqual(6)
    // El orden es el del catálogo base (sort_order), no el alfabético.
    expect(groups[0].name).toBe('Perros')

    const created = await speciesService.create(TENANT_PATITAS, {
      name: '  Tarántula de prueba  ',
      group_id: groups[groups.length - 1].id,
      has_breeds: true,
    })
    expect(created.name).toBe('Tarántula de prueba') // sin espacios sobrantes
    expect(created.legacy_kind).toBe('other') // las especies nuevas no son perro ni gato

    const breed = await breedsService.create(TENANT_PATITAS, {
      name: 'Variedad de prueba',
      species_id: created.id,
      search_aliases: ['vp'],
    })
    expect(breed.search_aliases).toEqual(['vp'])

    const renamed = await breedsService.update(breed.id, {
      name: 'Variedad renombrada',
      species_id: created.id,
      search_aliases: [],
    })
    expect(renamed.name).toBe('Variedad renombrada')

    await breedsService.hide(breed.id)
    expect((await breedsService.list(TENANT_PATITAS)).map((b) => b.id)).not.toContain(
      breed.id,
    )

    await speciesService.hide(created.id)
    expect((await speciesService.list(TENANT_PATITAS)).map((s) => s.id)).not.toContain(
      created.id,
    )
  })

  // Qué prueba: que un groomer no puede escribir el catálogo aunque llame al servicio directo.
  // La pantalla no le ofrece la ruta, pero la regla real es la política RLS.
  it('un groomer no puede crear una especie: la base lo rechaza', async () => {
    await signIn('groomer@patitasfelices.mx')
    const groups = await speciesService.listGroups(TENANT_PATITAS)
    await expect(
      speciesService.create(TENANT_PATITAS, {
        name: 'No debería existir',
        group_id: groups[0].id,
        has_breeds: false,
      }),
    ).rejects.toThrow()
  })
})
