// Pruebas de useFirstLoad: la silueta solo en la primera carga; después, las filas se conservan.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, ref } from 'vue'

import { useFirstLoad } from './useFirstLoad'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

function setup() {
  const loading = ref(false)
  const scope = effectScope()
  const state = scope.run(() => useFirstLoad(loading, 150))!
  return { loading, state, scope }
}

describe('useFirstLoad', () => {
  // Qué prueba: antes de que arranque la carga ya cuenta como primera carga. Si no,
  // habría un instante de tabla vacía con "No hay clientes" antes de pedir los datos.
  it('antes de cargar ya es primera carga', () => {
    const { state, scope } = setup()
    expect(state.isFirstLoad.value).toBe(true)
    scope.stop()
  })

  // Qué prueba: una carga lenta enseña la silueta, y al terminar la primera carga la
  // silueta se apaga y deja de ser "primera carga". Si fallara, la silueta taparía la tabla.
  it('muestra la silueta si la primera carga tarda y la quita al terminar', async () => {
    const { loading, state, scope } = setup()
    loading.value = true
    vi.advanceTimersByTime(200)
    expect(state.showSkeleton.value).toBe(true)

    loading.value = false
    await nextTick()

    expect(state.isFirstLoad.value).toBe(false)
    expect(state.showSkeleton.value).toBe(false)
    scope.stop()
  })

  // Qué prueba: una recarga (buscar, filtrar) NO vuelve a ser primera carga. Si fallara,
  // cada búsqueda reemplazaría la tabla por la silueta y se vería parpadear.
  it('las recargas no vuelven a mostrar la silueta', async () => {
    const { loading, state, scope } = setup()
    loading.value = true
    loading.value = false
    await nextTick()

    loading.value = true
    await nextTick()
    vi.advanceTimersByTime(500)

    expect(state.isFirstLoad.value).toBe(false)
    expect(state.showSkeleton.value).toBe(false)
    scope.stop()
  })

  // Qué prueba: si la primera carga falla, igual termina. Si no, la pantalla se quedaría
  // en silueta para siempre y el mensaje de error nunca se vería.
  it('una primera carga que falla también termina', () => {
    const { loading, state, scope } = setup()
    loading.value = true
    loading.value = false
    expect(state.isFirstLoad.value).toBe(false)
    scope.stop()
  })
})
