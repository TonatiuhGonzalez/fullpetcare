// Pruebas de useNavigationProgress: la barra del router solo aparece si el cambio de
// pantalla tarda, y siempre se apaga al terminar.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope } from 'vue'

import {
  finishNavigation,
  startNavigation,
  useNavigationProgress,
} from './useNavigationProgress'

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  finishNavigation()
  vi.useRealTimers()
})

describe('useNavigationProgress', () => {
  // Qué prueba: con red normal el cambio de pantalla termina antes del retraso y la
  // barra no se ve. Si fallara, parpadearía en cada clic del menú.
  it('una navegación rápida no muestra la barra', async () => {
    const scope = effectScope()
    const visible = scope.run(() => useNavigationProgress(150))!

    startNavigation()
    await Promise.resolve()
    vi.advanceTimersByTime(100)
    finishNavigation()
    await Promise.resolve()
    vi.advanceTimersByTime(500)

    expect(visible.value).toBe(false)
    scope.stop()
  })

  // Qué prueba: con red lenta la barra aparece, y se apaga al llegar la pantalla.
  // Si fallara, la persona no vería señal de que su clic funcionó, o la barra se
  // quedaría encendida sobre una pantalla ya cargada.
  it('una navegación lenta muestra la barra y la apaga al terminar', async () => {
    const scope = effectScope()
    const visible = scope.run(() => useNavigationProgress(150))!

    startNavigation()
    await Promise.resolve()
    vi.advanceTimersByTime(200)
    expect(visible.value).toBe(true)

    finishNavigation()
    await Promise.resolve()
    expect(visible.value).toBe(false)
    scope.stop()
  })
})
