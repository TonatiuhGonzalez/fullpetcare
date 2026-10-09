// Pruebas de useThemeMode: cómo se elige, se guarda y se aplica el tema.
// En lugar de Vuetify real se usa un "destino falso" que solo anota los cambios de
// tema que le piden: así se prueba la decisión sin cargar la interfaz.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DARK_THEME, LIGHT_THEME } from '@/lib/themeMode'
import { initThemeMode, useThemeMode } from './useThemeMode'

// Un "sistema operativo falso": expone si prefiere oscuro y deja simular que cambia.
function fakeSystem(prefersDark: boolean) {
  const listeners: Array<(e: { matches: boolean }) => void> = []
  const query = {
    matches: prefersDark,
    addEventListener: (_: string, cb: (e: { matches: boolean }) => void) =>
      listeners.push(cb),
    removeEventListener: (_: string, cb: (e: { matches: boolean }) => void) => {
      listeners.splice(listeners.indexOf(cb), 1)
    },
  }
  vi.stubGlobal('matchMedia', () => query)
  return { change: (matches: boolean) => listeners.forEach((cb) => cb({ matches })) }
}

function fakeTarget() {
  const applied: string[] = []
  return { change: (name: string) => applied.push(name), applied }
}

beforeEach(() => localStorage.clear())
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('initThemeMode', () => {
  // Qué prueba: el caso que más importa para no romper la app: el almacenamiento del
  // navegador lanza error (modo privado estricto). Debe usar el tema del sistema y
  // NO tronar. Si tronara, la pantalla quedaría en blanco antes del login.
  it('sin almacenamiento disponible usa el tema del sistema y no truena', () => {
    fakeSystem(true)
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('bloqueado')
    })
    const target = fakeTarget()
    expect(() => initThemeMode(target)).not.toThrow()
    expect(target.applied.at(-1)).toBe(DARK_THEME)
  })

  // Qué prueba: un navegador sin `matchMedia` (muy antiguo o entorno raro). Debe
  // caer al tema claro en vez de lanzar error al arrancar.
  it('si el navegador no sabe de preferencias del sistema, usa el claro', () => {
    vi.stubGlobal('matchMedia', undefined)
    const target = fakeTarget()
    initThemeMode(target)
    expect(target.applied.at(-1)).toBe(LIGHT_THEME)
  })

  // Qué prueba: que lo guardado antes se respeta al recargar, aunque el sistema
  // pida lo contrario.
  it('respeta el modo guardado aunque el sistema pida otro', () => {
    fakeSystem(true)
    localStorage.setItem('fpc.themeMode', 'light')
    const target = fakeTarget()
    initThemeMode(target)
    expect(target.applied.at(-1)).toBe(LIGHT_THEME)
  })

  // Qué prueba: que un valor guardado inválido no rompe el arranque: se trata como
  // "sistema".
  it('ignora un valor guardado inválido', () => {
    fakeSystem(false)
    localStorage.setItem('fpc.themeMode', 'azul')
    const target = fakeTarget()
    initThemeMode(target)
    expect(useThemeMode().mode.value).toBe('system')
    expect(target.applied.at(-1)).toBe(LIGHT_THEME)
  })
})

describe('useThemeMode', () => {
  // Qué prueba: que elegir un modo lo aplica al instante Y lo guarda para la
  // próxima visita. Si no se guardara, la elección se perdería al recargar.
  it('setMode aplica el tema y lo guarda', () => {
    fakeSystem(false)
    const target = fakeTarget()
    initThemeMode(target)
    useThemeMode().setMode('dark')
    expect(target.applied.at(-1)).toBe(DARK_THEME)
    expect(localStorage.getItem('fpc.themeMode')).toBe('dark')
    expect(useThemeMode().isDark.value).toBe(true)
  })

  // Qué prueba: que si guardar falla, el cambio de tema SÍ se aplica. Sin esto, en
  // un navegador sin almacenamiento el interruptor "no haría nada".
  it('si guardar falla, igual cambia el tema', () => {
    fakeSystem(false)
    const target = fakeTarget()
    initThemeMode(target)
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('bloqueado')
    })
    expect(() => useThemeMode().setMode('dark')).not.toThrow()
    expect(target.applied.at(-1)).toBe(DARK_THEME)
  })

  // Qué prueba: que en modo "sistema" la app acompaña al sistema si cambia mientras
  // está abierta (p. ej. el Mac pasa a oscuro al anochecer), pero que un modo fijo no.
  it('en modo sistema sigue los cambios del sistema; en modo fijo no', () => {
    const system = fakeSystem(false)
    const target = fakeTarget()
    initThemeMode(target)
    system.change(true)
    expect(target.applied.at(-1)).toBe(DARK_THEME)
    useThemeMode().setMode('light')
    system.change(true)
    expect(target.applied.at(-1)).toBe(LIGHT_THEME)
  })
})
