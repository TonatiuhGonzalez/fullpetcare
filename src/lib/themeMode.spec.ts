// Pruebas de la lógica pura del modo de color (claro, oscuro o sistema).
import { describe, expect, it } from 'vitest'

import { DARK_THEME, LIGHT_THEME, parseThemeMode, resolveThemeName } from './themeMode'

describe('parseThemeMode', () => {
  // Qué prueba: que los tres valores válidos pasan tal cual. Si fallara, la
  // preferencia guardada nunca se respetaría al recargar.
  it('acepta los tres modos conocidos', () => {
    expect(parseThemeMode('system')).toBe('system')
    expect(parseThemeMode('light')).toBe('light')
    expect(parseThemeMode('dark')).toBe('dark')
  })

  // Qué prueba: que un valor basura o ausente cae a "sistema". Lo guardado en el
  // navegador puede venir vacío, editado o de una versión vieja; con esto la app
  // arranca siempre con un tema válido en vez de sin colores.
  it('vuelve a "sistema" con nulo, vacío o un valor desconocido', () => {
    expect(parseThemeMode(null)).toBe('system')
    expect(parseThemeMode(undefined)).toBe('system')
    expect(parseThemeMode('')).toBe('system')
    expect(parseThemeMode('azul')).toBe('system')
  })
})

describe('resolveThemeName', () => {
  // Qué prueba: que en modo "sistema" manda lo que pida el sistema operativo.
  it('en modo sistema sigue la preferencia del sistema', () => {
    expect(resolveThemeName('system', true)).toBe(DARK_THEME)
    expect(resolveThemeName('system', false)).toBe(LIGHT_THEME)
  })

  // Qué prueba: que elegir claro u oscuro a mano gana sobre el sistema. Si no, una
  // persona que fija el modo claro vería la app oscura cada noche contra su voluntad.
  it('en modo claro u oscuro ignora al sistema', () => {
    expect(resolveThemeName('light', true)).toBe(LIGHT_THEME)
    expect(resolveThemeName('dark', false)).toBe(DARK_THEME)
  })
})
