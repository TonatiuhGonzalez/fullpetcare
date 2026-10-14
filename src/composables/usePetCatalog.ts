// Catálogo de especies y razas para los formularios de mascota (fase 27): lo carga una vez
// por negocio (stores/speciesCatalog.ts) y calcula "hoy" en la zona de la SUCURSAL, no la del
// navegador (CLAUDE.md §8.3), porque la edad se mide contra ese día.
import { computed, ref } from 'vue'

import { branchToday } from '@/lib/datetime'
import { useSessionStore } from '@/stores/session'
import { useSpeciesCatalogStore } from '@/stores/speciesCatalog'

export function usePetCatalog() {
  const catalog = useSpeciesCatalogStore()
  const session = useSessionStore()
  const loadError = ref<string | null>(null)

  const today = computed(() =>
    branchToday(session.activeBranch?.timezone ?? 'America/Mexico_City'),
  )

  /** Carga el catálogo si hace falta; si falla, deja el mensaje en `loadError`. */
  async function ensureLoaded(tenantId: string): Promise<void> {
    loadError.value = null
    try {
      await catalog.load(tenantId)
    } catch {
      loadError.value =
        'No se pudo cargar el catálogo de especies y razas. Revisa tu conexión.'
    }
  }

  return { catalog, today, loadError, ensureLoaded }
}
