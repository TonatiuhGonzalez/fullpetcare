// Estado compartido del modo de color (claro, oscuro o el del sistema). Se prepara
// una sola vez al arrancar (`initThemeMode`, en main.ts, antes de montar la app para
// que no parpadee el tema equivocado) y cualquier componente lo consulta o cambia
// con `useThemeMode()`.
//
// La preferencia se guarda en el navegador de cada persona: es una comodidad, no un
// dato de negocio (por eso no va a la base). Si el almacenamiento falla (modo
// privado estricto, datos bloqueados), la app sigue y simplemente usa el tema del
// sistema; nunca se cae por esto.
import { computed, ref } from 'vue'

import {
  DARK_THEME,
  parseThemeMode,
  resolveThemeName,
  type ThemeMode,
} from '@/lib/themeMode'

const STORAGE_KEY = 'fpc.themeMode'

// Lo único que se necesita de Vuetify: poder pedirle que cambie de tema.
export interface ThemeTarget {
  change: (themeName: string) => void
}

const mode = ref<ThemeMode>('system')
const systemPrefersDark = ref(false)
const themeName = computed(() => resolveThemeName(mode.value, systemPrefersDark.value))
const isDark = computed(() => themeName.value === DARK_THEME)

let target: ThemeTarget | null = null
let stopListening: (() => void) | null = null

function readStored(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

function writeStored(value: ThemeMode): void {
  try {
    localStorage.setItem(STORAGE_KEY, value)
  } catch {
    // Se ignora a propósito: sin almacenamiento solo se pierde recordar la elección.
  }
}

function apply(): void {
  target?.change(themeName.value)
}

// Escucha los cambios del sistema (p. ej. se activa el modo oscuro del Mac por la
// noche). Devuelve cómo dejar de escuchar, o nada si el navegador no sabe.
function watchSystem(): (() => void) | null {
  try {
    if (typeof window.matchMedia !== 'function') return null
    const query = window.matchMedia('(prefers-color-scheme: dark)')
    systemPrefersDark.value = query.matches
    const onChange = (event: MediaQueryListEvent): void => {
      systemPrefersDark.value = event.matches
      apply()
    }
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  } catch {
    return null
  }
}

export function initThemeMode(themeTarget: ThemeTarget): void {
  target = themeTarget
  stopListening?.()
  mode.value = parseThemeMode(readStored())
  systemPrefersDark.value = false
  stopListening = watchSystem()
  apply()
}

export function useThemeMode() {
  function setMode(next: ThemeMode): void {
    mode.value = next
    writeStored(next)
    apply()
  }
  return { mode, isDark, setMode }
}
