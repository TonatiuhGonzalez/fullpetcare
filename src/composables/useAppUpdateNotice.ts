// Estado del aviso "Hay una versión nueva" (PLAN.md D22). El router lo enciende
// cuando una pantalla no se puede descargar (`router.onError`) y
// `AppUpdateNotice.vue` lo muestra. Nada se recarga solo: la página se recarga
// únicamente cuando la persona pulsa el botón, así que no puede haber un bucle de
// recargas aunque el archivo siga sin existir.
import { ref } from 'vue'

export const APP_UPDATE_MESSAGE =
  'Hay una versión nueva de FullPetCare. Recarga la página para continuar.'

const visible = ref(false)

export function showAppUpdateNotice(): void {
  visible.value = true
}

export function useAppUpdateNotice() {
  return {
    visible,
    reload: () => window.location.reload(),
  }
}
