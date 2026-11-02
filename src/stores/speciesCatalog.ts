// Catálogo de grupos, especies y razas del negocio activo (fase 27, PLAN.md D30), listo para
// los selectores del formulario de mascota. Se carga una vez por negocio y se conserva:
// cambia poco y se pide desde varios diálogos. La pantalla de Configuración que lo edita
// llama `load(tenantId, true)` al guardar para refrescarlo.
import { computed, ref } from 'vue'
import { defineStore } from 'pinia'

import * as breedsService from '@/services/breeds'
import type { Breed } from '@/services/breeds'
import * as speciesService from '@/services/species'
import type { Species, SpeciesGroup } from '@/services/species'

export const useSpeciesCatalogStore = defineStore('speciesCatalog', () => {
  const groups = ref<SpeciesGroup[]>([])
  const species = ref<Species[]>([])
  const breeds = ref<Breed[]>([])
  const loading = ref(false)
  const loadedTenantId = ref<string | null>(null)
  // La carga en curso: dos diálogos que piden el catálogo a la vez comparten una sola petición.
  let inFlight: Promise<void> | null = null

  /** Pide el catálogo del negocio; no repite la petición si ya está cargado (salvo `force`). */
  async function load(tenantId: string, force = false): Promise<void> {
    if (!force && loadedTenantId.value === tenantId) return
    if (inFlight) return inFlight

    loading.value = true
    inFlight = (async () => {
      try {
        const [g, s, b] = await Promise.all([
          speciesService.listGroups(tenantId),
          speciesService.list(tenantId),
          breedsService.list(tenantId),
        ])
        groups.value = g
        species.value = s
        breeds.value = b
        loadedTenantId.value = tenantId
      } finally {
        loading.value = false
        inFlight = null
      }
    })()
    return inFlight
  }

  /** Las especies de un grupo, por nombre. */
  function speciesOfGroup(groupId: string): Species[] {
    return species.value.filter((s) => s.group_id === groupId)
  }

  /** Las razas de una especie, por nombre. */
  function breedsOfSpecies(speciesId: string | null): Breed[] {
    if (!speciesId) return []
    return breeds.value.filter((b) => b.species_id === speciesId)
  }

  const speciesById = computed(() => new Map(species.value.map((s) => [s.id, s])))

  function reset(): void {
    groups.value = []
    species.value = []
    breeds.value = []
    loadedTenantId.value = null
  }

  return {
    groups,
    species,
    breeds,
    loading,
    loadedTenantId,
    speciesById,
    load,
    speciesOfGroup,
    breedsOfSpecies,
    reset,
  }
})
