// Reglas del aviso "Agregar a inicio" (fase 16A, PLAN.md D21). Funciones puras: leer el
// navegador y el almacenamiento es trabajo de composables/usePwaInstall.ts.

/** Cuántos días se respeta un "Ahora no" antes de volver a mostrar el aviso. */
export const INSTALL_HINT_SNOOZE_DAYS = 30

/**
 * Qué aviso corresponde:
 *  - `installed`: ya abre como app; no hay nada que sugerir.
 *  - `prompt`: el navegador (Chrome en Android) ofrece instalar con un toque.
 *  - `ios`: Safari no ofrece diálogo; hay que explicar el menú Compartir.
 *  - `none`: no se puede instalar desde aquí (escritorio sin soporte, navegador sin PWA).
 */
export type InstallMode = 'installed' | 'prompt' | 'ios' | 'none'

/**
 * ¿Es un iPhone o iPad? iPadOS 13+ se identifica como un Mac: se distingue por la pantalla
 * táctil (un Mac real no reporta puntos táctiles).
 */
export function isIosDevice(userAgent: string, maxTouchPoints: number): boolean {
  if (/iPhone|iPad|iPod/i.test(userAgent)) return true
  return /Macintosh/i.test(userAgent) && maxTouchPoints > 1
}

export interface InstallEnvironment {
  userAgent: string
  maxTouchPoints: number
  /** La app ya está abierta como app instalada (display-mode standalone). */
  isStandalone: boolean
  /** El navegador disparó `beforeinstallprompt` y se guardó el evento. */
  hasPromptEvent: boolean
}

export function installMode(env: InstallEnvironment): InstallMode {
  if (env.isStandalone) return 'installed'
  if (env.hasPromptEvent) return 'prompt'
  if (isIosDevice(env.userAgent, env.maxTouchPoints)) return 'ios'
  return 'none'
}

/**
 * ¿Se muestra el aviso? Solo si hay algo que sugerir y la persona no lo descartó hace poco.
 * `dismissedAt` es la marca de tiempo (ms) del último "Ahora no", o nulo si nunca.
 */
export function shouldShowInstallHint(
  mode: InstallMode,
  dismissedAt: number | null,
  now: number,
): boolean {
  if (mode === 'installed' || mode === 'none') return false
  if (dismissedAt === null || Number.isNaN(dismissedAt)) return true
  const snoozeMs = INSTALL_HINT_SNOOZE_DAYS * 24 * 60 * 60 * 1000
  return now - dismissedAt >= snoozeMs
}
