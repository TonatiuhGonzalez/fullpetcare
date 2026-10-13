// Convierte "está cargando" en "enséñalo", pero solo si la espera se nota.
//
// Si los datos llegan en 80 ms, mostrar un skeleton o una barra sería un parpadeo
// molesto: aparece y desaparece antes de que la persona lo lea. Por eso el indicador
// espera `delayMs` (150 por defecto, PLAN.md D22) y solo se enciende si la carga
// sigue en curso. Al terminar la carga se apaga de inmediato.
//
// Uso: `const showSkeleton = useDelayedLoading(loading)` y en el template
// `v-if="showSkeleton"`. Para pintar siempre "cargando" desde el primer instante
// (p. ej. para no mostrar la pantalla vacía) se usa `loading` directo, no este.
import { onScopeDispose, ref, watch, type Ref, type WatchSource } from 'vue'

export const DEFAULT_LOADING_DELAY_MS = 150

export function useDelayedLoading(
  source: WatchSource<boolean>,
  delayMs: number = DEFAULT_LOADING_DELAY_MS,
): Readonly<Ref<boolean>> {
  const visible = ref(false)
  let timer: ReturnType<typeof setTimeout> | null = null

  function clearTimer(): void {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
  }

  watch(
    source,
    (isLoading) => {
      clearTimer()
      if (!isLoading) {
        visible.value = false
        return
      }
      timer = setTimeout(() => {
        timer = null
        visible.value = true
      }, delayMs)
    },
    { immediate: true },
  )

  // Si la pantalla se cierra a media carga, el temporizador no debe quedar vivo
  // tocando un componente que ya no existe.
  onScopeDispose(clearTimer)

  return visible
}
