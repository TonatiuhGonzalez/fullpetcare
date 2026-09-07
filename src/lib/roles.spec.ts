// Tests de lib/roles.ts (revisión de cobertura, tarea 8.2) — nunca tuvo
// los suyos: se usa en AppLayout.vue/SelectBusinessPage.vue, pero un
// archivo de mapeo de etiquetas nunca se prueba a través de un
// componente. Corto, pero real: hay UN caso de borde (`role` nulo) que
// vale la pena fijar con un test — sin él, alguien podría "simplificar"
// el `if` y romper la pantalla de selección de negocio antes de que
// exista una membresía activa.
import { describe, expect, it } from 'vitest'

import { roleLabel } from './roles'

describe('roleLabel', () => {
  it('traduce cada rol al español', () => {
    expect(roleLabel('owner')).toBe('Dueño')
    expect(roleLabel('receptionist')).toBe('Recepción')
    expect(roleLabel('groomer')).toBe('Groomer')
    expect(roleLabel('vet')).toBe('Veterinario')
  })

  it('da una cadena vacía si todavía no hay rol (sin membresía activa elegida)', () => {
    expect(roleLabel(null)).toBe('')
  })
})
