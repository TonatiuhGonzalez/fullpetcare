// Estado compartido de "se está cambiando de pantalla" (PLAN.md D22).
//
// Las pantallas se descargan al visitarlas (`() => import(...)` en el router), así
// que al elegir otra opción del menú la pantalla anterior se queda quieta mientras
// baja la nueva. El router avisa aquí cuándo empieza y cuándo termina la navegación
// (éxito, cancelación o error) y `NavigationProgress.vue` dibuja la barra de arriba.
// Es un simple sí/no, no un contador: si una navegación se cancela por una
// redirección y llega otra enseguida, lo peor es que la barra se apague un instante
// antes, nunca que se quede encendida para siempre.
import { ref } from 'vue'

import { useDelayedLoading } from './useDelayedLoading'

const navigating = ref(false)

export function startNavigation(): void {
  navigating.value = true
}

export function finishNavigation(): void {
  navigating.value = false
}

// La barra solo se enseña si la navegación tarda (retraso de useDelayedLoading):
// con red normal el cambio de pantalla es instantáneo y no debe aparecer nada.
export function useNavigationProgress(delayMs?: number) {
  return useDelayedLoading(navigating, delayMs)
}
