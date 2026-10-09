// Modo de color de la interfaz (PLAN.md D20): el tema puede seguir al sistema
// operativo, o quedar fijo en claro u oscuro. Aquí solo vive la lógica pura de
// "qué modo es y qué tema le toca"; leer el almacenamiento y hablar con Vuetify
// es trabajo de composables/useThemeMode.ts.

export type ThemeMode = 'system' | 'light' | 'dark'

// Nombres de los temas registrados en plugins/vuetify.ts.
export const LIGHT_THEME = 'fullPetCareLight'
export const DARK_THEME = 'fullPetCareDark'

const MODES: ThemeMode[] = ['system', 'light', 'dark']

// Lo que hay guardado en el navegador es texto que cualquiera pudo editar o que
// quedó de otra versión de la app. Solo se acepta un valor conocido; cualquier otra
// cosa (nulo, vacío, "azul") vuelve a "sistema" en vez de romper el tema.
export function parseThemeMode(raw: string | null | undefined): ThemeMode {
  return MODES.find((mode) => mode === raw) ?? 'system'
}

// Qué tema aplicar: en modo "sistema" depende de lo que pida el sistema operativo;
// en claro u oscuro, el sistema se ignora.
export function resolveThemeName(mode: ThemeMode, systemPrefersDark: boolean): string {
  if (mode === 'light') return LIGHT_THEME
  if (mode === 'dark') return DARK_THEME
  return systemPrefersDark ? DARK_THEME : LIGHT_THEME
}
