// Búsqueda que se hace en la base mientras la persona teclea (C1.20).
//
// Resuelve tres cosas que cada pantalla tendría que repetir:
//   1. Espera un momento (`delayMs`) tras el último tecleo, para no mandar una consulta por letra.
//   2. Ignora respuestas viejas: si "sha" tarda más que "shampoo", no debe pisar al más reciente.
//   3. Con el texto vacío no consulta y el resultado es `null` ("sin filtro": se muestra todo).
//
// Mientras llega la respuesta de un texto nuevo se conserva el resultado anterior, así la lista
// no parpadea en blanco a cada letra.
import { onScopeDispose, ref, watch } from 'vue'
import type { Ref } from 'vue'

export function useServerSearch<T>(
  term: Ref<string>,
  fetcher: (term: string) => Promise<T>,
  delayMs = 200,
) {
  const result = ref<T | null>(null) as Ref<T | null>
  const pending = ref(false)
  const failed = ref(false)

  let timer: ReturnType<typeof setTimeout> | undefined
  // Cada consulta lleva un número; solo la última puede escribir el resultado.
  let latest = 0

  watch(term, (value) => {
    clearTimeout(timer)
    const text = value.trim()
    const mine = ++latest

    if (text === '') {
      result.value = null
      pending.value = false
      failed.value = false
      return
    }

    pending.value = true
    timer = setTimeout(async () => {
      try {
        const found = await fetcher(text)
        if (mine !== latest) return
        result.value = found
        failed.value = false
      } catch {
        if (mine !== latest) return
        result.value = null
        failed.value = true
      } finally {
        if (mine === latest) pending.value = false
      }
    }, delayMs)
  })

  onScopeDispose(() => clearTimeout(timer))

  return { result, pending, failed }
}
