// Distingue la PRIMERA carga de una pantalla de las recargas (PLAN.md D22).
//
// - Primera carga: aún no hay nada que enseñar, así que se muestra la silueta
//   (`showSkeleton`, con el retraso de useDelayedLoading para no parpadear).
// - Recargas (filtrar, buscar, guardar y refrescar): las filas que ya estaban se
//   conservan y la tabla solo lleva su barra fina. Así la tabla no parpadea ni se
//   vacía; y si una búsqueda no devuelve nada, se ve "sin resultados", no otra silueta.
//
// `isFirstLoad` vale true desde que se crea (antes de que empiece la carga) hasta que
// la primera carga TERMINA, con éxito o con error; así tampoco hay un instante
// de tabla vacía antes de arrancar. Uso en el template:
//   <TableSkeleton v-if="isFirstLoad && showSkeleton" />
//   <v-data-table v-else-if="!isFirstLoad" :loading="loading" ... />
import { computed, ref, watch, type Ref } from 'vue'

import { useDelayedLoading } from './useDelayedLoading'

export function useFirstLoad(loading: Ref<boolean>, delayMs?: number) {
  const hasLoadedOnce = ref(false)

  watch(
    loading,
    (isLoading, wasLoading) => {
      if (wasLoading && !isLoading) hasLoadedOnce.value = true
    },
    { flush: 'sync' },
  )

  const isFirstLoad = computed(() => !hasLoadedOnce.value)
  const showSkeleton = useDelayedLoading(isFirstLoad, delayMs)

  return { isFirstLoad, showSkeleton }
}
