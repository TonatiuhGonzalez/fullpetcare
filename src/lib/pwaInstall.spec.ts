// Tests de lib/pwaInstall.ts (fase 16A, tarea 16.3): cuándo y cómo se sugiere instalar la app.
import { describe, expect, it } from 'vitest'

import {
  INSTALL_HINT_SNOOZE_DAYS,
  installMode,
  isIosDevice,
  shouldShowInstallHint,
} from './pwaInstall'

const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1'
const MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15'
const ANDROID =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36'

describe('isIosDevice', () => {
  // Qué prueba: el iPhone se reconoce por su agente de usuario.
  it('reconoce un iPhone', () => {
    expect(isIosDevice(IPHONE, 5)).toBe(true)
  })

  // Qué prueba: un iPad con iPadOS 13+ se hace pasar por Mac; solo la pantalla táctil lo delata.
  // Qué se rompería: en un iPad nunca saldría la instrucción de "Agregar a inicio".
  it('reconoce un iPad que se identifica como Mac por sus puntos táctiles', () => {
    expect(isIosDevice(MAC, 5)).toBe(true)
  })

  // Qué prueba: un Mac de escritorio (sin pantalla táctil) no es iOS.
  it('no confunde un Mac de escritorio con un iPad', () => {
    expect(isIosDevice(MAC, 0)).toBe(false)
  })
})

describe('installMode', () => {
  const base = {
    userAgent: ANDROID,
    maxTouchPoints: 5,
    isStandalone: false,
    hasPromptEvent: false,
  }

  // Qué prueba: ya abierta como app, no se sugiere nada, aunque haya evento de instalación.
  it('instalada tiene prioridad sobre todo', () => {
    expect(installMode({ ...base, isStandalone: true, hasPromptEvent: true })).toBe(
      'installed',
    )
  })

  it('con el evento del navegador ofrece instalar con un toque', () => {
    expect(installMode({ ...base, hasPromptEvent: true })).toBe('prompt')
  })

  // Qué prueba: iOS no dispara el evento, así que se cae a la instrucción manual.
  it('en iOS sin evento explica el menú Compartir', () => {
    expect(installMode({ ...base, userAgent: IPHONE })).toBe('ios')
  })

  it('sin soporte no sugiere nada', () => {
    expect(installMode(base)).toBe('none')
  })
})

describe('shouldShowInstallHint', () => {
  const now = Date.UTC(2026, 9, 14)
  const day = 24 * 60 * 60 * 1000

  // Qué prueba: nunca descartado → se muestra.
  it('muestra el aviso si nunca se descartó', () => {
    expect(shouldShowInstallHint('prompt', null, now)).toBe(true)
    expect(shouldShowInstallHint('ios', null, now)).toBe(true)
  })

  // Qué prueba: el borde del "Ahora no": un día antes de cumplirse el plazo no sale; en el
  // día exacto sí vuelve.
  // Qué se rompería: el aviso volvería a salir en cada visita y molestaría, o nunca regresaría.
  it('respeta el "Ahora no" durante el plazo y vuelve al cumplirse', () => {
    const snooze = INSTALL_HINT_SNOOZE_DAYS * day
    expect(shouldShowInstallHint('prompt', now - snooze + day, now)).toBe(false)
    expect(shouldShowInstallHint('prompt', now - snooze, now)).toBe(true)
  })

  // Qué prueba: sin nada que sugerir no se muestra, descartado o no.
  it('no muestra nada si ya está instalada o no hay soporte', () => {
    expect(shouldShowInstallHint('installed', null, now)).toBe(false)
    expect(shouldShowInstallHint('none', null, now)).toBe(false)
  })

  // Qué prueba: un valor corrupto en el almacenamiento no apaga el aviso para siempre.
  it('trata un valor guardado inválido como "nunca descartado"', () => {
    expect(shouldShowInstallHint('prompt', Number.NaN, now)).toBe(true)
  })
})
