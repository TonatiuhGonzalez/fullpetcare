// Tests de stores/speciesCatalog.ts (fase 27): carga única y consulta por grupo y especie.
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useSpeciesCatalogStore } from './speciesCatalog'

const listGroups = vi.fn()
const listSpecies = vi.fn()
const listBreeds = vi.fn()

vi.mock('@/services/species', () => ({
  listGroups: (...a: unknown[]) => listGroups(...a),
  list: (...a: unknown[]) => listSpecies(...a),
}))
vi.mock('@/services/breeds', () => ({ list: (...a: unknown[]) => listBreeds(...a) }))

beforeEach(() => {
  setActivePinia(createPinia())
  listGroups.mockReset().mockResolvedValue([{ id: 'g1', name: 'Perros' }])
  listSpecies.mockReset().mockResolvedValue([
    { id: 's1', group_id: 'g1', name: 'Perro' },
    { id: 's2', group_id: 'g2', name: 'Loro' },
  ])
  listBreeds.mockReset().mockResolvedValue([
    { id: 'b1', species_id: 's1', name: 'Labrador' },
    { id: 'b2', species_id: 's1', name: 'Pug' },
  ])
})

describe('useSpeciesCatalogStore', () => {
  // Qué prueba: que pedir el catálogo dos veces para el mismo negocio hace UNA sola petición.
  // Qué se rompería: cada diálogo de mascota que se abre repetiría tres consultas a la base.
  it('no repite la carga del mismo negocio, salvo que se fuerce', async () => {
    const store = useSpeciesCatalogStore()
    await store.load('t1')
    await store.load('t1')
    expect(listGroups).toHaveBeenCalledTimes(1)

    await store.load('t1', true)
    expect(listGroups).toHaveBeenCalledTimes(2)
  })

  // Qué prueba: dos diálogos que piden el catálogo a la vez comparten la misma petición.
  it('comparte la petición en curso', async () => {
    const store = useSpeciesCatalogStore()
    await Promise.all([store.load('t1'), store.load('t1')])
    expect(listSpecies).toHaveBeenCalledTimes(1)
  })

  // Qué prueba: cambiar de negocio recarga; si no, se mostraría el catálogo del anterior.
  it('recarga al cambiar de negocio', async () => {
    const store = useSpeciesCatalogStore()
    await store.load('t1')
    await store.load('t2')
    expect(listGroups).toHaveBeenCalledTimes(2)
    expect(store.loadedTenantId).toBe('t2')
  })

  // Qué prueba: las razas salen de la especie correcta y una especie nula no trae ninguna.
  it('devuelve las razas de la especie pedida y vacío sin especie', async () => {
    const store = useSpeciesCatalogStore()
    await store.load('t1')
    expect(store.breedsOfSpecies('s1').map((b) => b.name)).toEqual(['Labrador', 'Pug'])
    expect(store.breedsOfSpecies('s2')).toEqual([])
    expect(store.breedsOfSpecies(null)).toEqual([])
    expect(store.speciesOfGroup('g1').map((s) => s.name)).toEqual(['Perro'])
  })
})
