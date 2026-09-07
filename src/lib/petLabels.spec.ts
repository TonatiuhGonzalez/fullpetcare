// Tests de lib/petLabels.ts (revisión de cobertura, tarea 8.2) — mismo
// motivo que roles.spec.ts: sin los suyos hasta ahora, solo se veía a
// través de PetDetailPage.vue/PublicPetPage.vue. `sexLabel` tiene un caso
// de borde real (sexo no especificado al dar de alta la mascota, CLAUDE.md
// no lo trata como un tercer valor del enum) que vale fijar con un test.
import { describe, expect, it } from 'vitest'

import { sexLabel, speciesLabel } from './petLabels'

describe('speciesLabel', () => {
  it('traduce cada especie al español', () => {
    expect(speciesLabel('dog')).toBe('Perro')
    expect(speciesLabel('cat')).toBe('Gato')
    expect(speciesLabel('other')).toBe('Otro')
  })
})

describe('sexLabel', () => {
  it('traduce macho y hembra', () => {
    expect(sexLabel('male')).toBe('Macho')
    expect(sexLabel('female')).toBe('Hembra')
  })

  it('da "No especificado" cuando no se capturó al dar de alta (no es un tercer valor del enum)', () => {
    expect(sexLabel(null)).toBe('No especificado')
  })
})
