// Prueba la búsqueda con retraso y sin respuestas viejas. Si fallara en producción: una
// respuesta lenta de "sha" pisaría la de "shampoo" y la lista mostraría productos que ya no
// coinciden con lo escrito, o se mandaría una consulta por cada letra tecleada.
import { effectScope, nextTick, ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useServerSearch } from './useServerSearch'

function setup(fetcher: (t: string) => Promise<string[]>) {
  const term = ref('')
  const scope = effectScope()
  const search = scope.run(() => useServerSearch(term, fetcher, 200))!
  return { term, search, scope }
}

describe('useServerSearch', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('no consulta con el texto vacío y deja el resultado en null', async () => {
    const fetcher = vi.fn(async () => ['x'])
    const { term, search } = setup(fetcher)
    term.value = '   '
    await nextTick()
    await vi.advanceTimersByTimeAsync(500)
    expect(fetcher).not.toHaveBeenCalled()
    expect(search.result.value).toBeNull()
  })

  it('espera a que termine de teclear y manda una sola consulta', async () => {
    const fetcher = vi.fn(async (t: string) => [t])
    const { term, search } = setup(fetcher)
    term.value = 's'
    await nextTick()
    await vi.advanceTimersByTimeAsync(100)
    term.value = 'sh'
    await nextTick()
    await vi.advanceTimersByTimeAsync(250)
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fetcher).toHaveBeenCalledWith('sh')
    expect(search.result.value).toEqual(['sh'])
  })

  it('una respuesta vieja no pisa a la más reciente', async () => {
    let releaseFirst!: (v: string[]) => void
    const fetcher = vi
      .fn()
      .mockImplementationOnce(() => new Promise<string[]>((r) => (releaseFirst = r)))
      .mockImplementationOnce(async () => ['nuevo'])
    const { term, search } = setup(fetcher)
    term.value = 'sha'
    await nextTick()
    await vi.advanceTimersByTimeAsync(250)
    term.value = 'shampoo'
    await nextTick()
    await vi.advanceTimersByTimeAsync(250)
    expect(search.result.value).toEqual(['nuevo'])
    releaseFirst(['viejo'])
    await vi.advanceTimersByTimeAsync(0)
    expect(search.result.value).toEqual(['nuevo'])
  })

  it('al borrar el texto vuelve a null y marca el fallo si la consulta falla', async () => {
    const fetcher = vi.fn().mockRejectedValueOnce(new Error('red')).mockResolvedValue(['ok'])
    const { term, search } = setup(fetcher)
    term.value = 'a'
    await nextTick()
    await vi.advanceTimersByTimeAsync(250)
    expect(search.failed.value).toBe(true)
    term.value = ''
    await nextTick()
    expect(search.failed.value).toBe(false)
    expect(search.result.value).toBeNull()
  })
})
