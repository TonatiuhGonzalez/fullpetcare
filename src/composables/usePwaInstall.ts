// Estado del aviso "Agregar a inicio" (fase 16A, PLAN.md D21): escucha el evento de
// instalación del navegador, sabe si la app ya está instalada y recuerda el "Ahora no" en
// este teléfono. Las reglas de cuándo mostrarlo viven en lib/pwaInstall.ts.
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

import { installMode, shouldShowInstallHint } from '@/lib/pwaInstall'

const DISMISSED_KEY = 'fpc.installHintDismissedAt'

// Evento que Chrome entrega una sola vez; hay que guardarlo para lanzarlo con un botón.
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

function readDismissedAt(): number | null {
  try {
    const raw = localStorage.getItem(DISMISSED_KEY)
    return raw === null ? null : Number(raw)
  } catch {
    // Almacenamiento bloqueado (ventana privada): se actúa como si nunca se hubiera descartado.
    return null
  }
}

function isStandalone(): boolean {
  const iosStandalone =
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  return iosStandalone || window.matchMedia('(display-mode: standalone)').matches
}

export function usePwaInstall() {
  const promptEvent = ref<BeforeInstallPromptEvent | null>(null)
  const standalone = ref(false)
  const dismissedAt = ref<number | null>(null)

  const mode = computed(() =>
    installMode({
      userAgent: typeof navigator === 'undefined' ? '' : navigator.userAgent,
      maxTouchPoints: typeof navigator === 'undefined' ? 0 : navigator.maxTouchPoints,
      isStandalone: standalone.value,
      hasPromptEvent: promptEvent.value !== null,
    }),
  )

  const showHint = computed(() =>
    shouldShowInstallHint(mode.value, dismissedAt.value, Date.now()),
  )

  function onBeforeInstallPrompt(event: Event): void {
    // Evita el mini aviso automático de Chrome: se ofrece con nuestro propio botón.
    event.preventDefault()
    promptEvent.value = event as BeforeInstallPromptEvent
  }

  function onInstalled(): void {
    promptEvent.value = null
    standalone.value = true
  }

  onMounted(() => {
    standalone.value = isStandalone()
    dismissedAt.value = readDismissedAt()
    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt)
    window.addEventListener('appinstalled', onInstalled)
  })

  onBeforeUnmount(() => {
    window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt)
    window.removeEventListener('appinstalled', onInstalled)
  })

  /** Lanza el diálogo de instalación del navegador (solo modo `prompt`). */
  async function install(): Promise<void> {
    const event = promptEvent.value
    if (!event) return
    await event.prompt()
    await event.userChoice
    // El evento solo sirve una vez: después de usarlo ya no hay nada que ofrecer.
    promptEvent.value = null
  }

  /** "Ahora no": se vuelve a sugerir pasado el plazo de `INSTALL_HINT_SNOOZE_DAYS`. */
  function dismiss(): void {
    const now = Date.now()
    dismissedAt.value = now
    try {
      localStorage.setItem(DISMISSED_KEY, String(now))
    } catch {
      // Sin almacenamiento solo se oculta mientras la página siga abierta.
    }
  }

  return { mode, showHint, install, dismiss }
}
