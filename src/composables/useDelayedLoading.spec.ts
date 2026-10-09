// Pruebas de useDelayedLoading: el indicador de carga solo aparece si la espera se nota.
// Se usan temporizadores falsos de Vitest: el "reloj" avanza a mano, sin esperar de verdad.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, ref } from 'vue'

import { useDelayedLoading } from './useDelayedLoading'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('useDelayedLoading', () => {
  // Qué prueba: una respuesta más rápida que el retraso no muestra nada. Si fallara,
  // cada recarga veloz haría parpadear el skeleton y la pantalla se vería nerviosa.
  it('una carga más rápida que el retraso nunca se muestra', async () => {
    const loading = ref(true)
    const visible = useDelayedLoading(loading, 150)

    vi.advanceTimersByTime(100)
    loading.value = false
    await nextTick()
    vi.advanceTimersByTime(500)

    expect(visible.value).toBe(false)
  })

  // Qué prueba: pasado el retraso, la carga sí se muestra. Si fallara, una consulta
  // lenta (red mala) dejaría la pantalla vacía sin ninguna señal.
  it('una carga más lenta que el retraso se muestra', () => {
    const visible = useDelayedLoading(ref(true), 150)

    vi.advanceTimersByTime(149)
    expect(visible.value).toBe(false)
    vi.advanceTimersByTime(1)
    expect(visible.value).toBe(true)
  })

  // Qué prueba: al llegar los datos el indicador se apaga en el acto. Si fallara, el
  // skeleton se quedaría encima del contenido ya cargado.
  it('al terminar la carga se apaga', async () => {
    const loading = ref(true)
    const visible = useDelayedLoading(loading, 150)
    vi.advanceTimersByTime(200)
    expect(visible.value).toBe(true)

    loading.value = false
    await nextTick()

    expect(visible.value).toBe(false)
  })

  // Qué prueba: dos cargas seguidas (p. ej. el usuario filtra dos veces). Cada una
  // espera su propio retraso completo; el temporizador viejo no debe encender el nuevo.
  it('una carga nueva reinicia la espera', async () => {
    const loading = ref(true)
    const visible = useDelayedLoading(loading, 150)
    vi.advanceTimersByTime(100)
    loading.value = false
    await nextTick()
    loading.value = true
    await nextTick()

    vi.advanceTimersByTime(100)
    expect(visible.value).toBe(false)
    vi.advanceTimersByTime(50)
    expect(visible.value).toBe(true)
  })

  // Qué prueba: sin carga desde el inicio no hay nada que mostrar, ni temporizador.
  it('si no está cargando desde el inicio no muestra nada', () => {
    const visible = useDelayedLoading(ref(false), 150)
    vi.advanceTimersByTime(1000)
    expect(visible.value).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  })

  // Qué prueba: la pantalla se cierra a media carga. El temporizador pendiente debe
  // cancelarse; si no, quedaría vivo tocando un componente que ya no existe (fuga).
  it('al desmontar el componente cancela el temporizador pendiente', () => {
    const scope = effectScope()
    const visible = scope.run(() => useDelayedLoading(ref(true), 150))!
    expect(vi.getTimerCount()).toBe(1)

    scope.stop()

    expect(vi.getTimerCount()).toBe(0)
    vi.advanceTimersByTime(500)
    expect(visible.value).toBe(false)
  })
})
