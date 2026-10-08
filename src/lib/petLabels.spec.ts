// Tests de lib/petLabels.ts (revisión de cobertura, tarea 8.2) — mismo
// motivo que roles.spec.ts: sin los suyos hasta ahora, solo se veía a
// través de PetDetailDialog.vue/PublicPetPage.vue. `sexLabel` tiene un caso
// de borde real (sexo no especificado al dar de alta la mascota, CLAUDE.md
// no lo trata como un tercer valor del enum) que vale fijar con un test.
import { describe, expect, it } from 'vitest'

import { sexLabel, speciesLabel, sterilizationIndicator } from './petLabels'

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

describe('sterilizationIndicator', () => {
  // Verde = esterilizada, amarillo = no (decisión de la fase 14). Si se
  // invirtieran, recepción leería al revés el estado de la mascota.
  it('verde si está esterilizada y amarillo si no', () => {
    expect(sterilizationIndicator(true).color).toBe('success')
    expect(sterilizationIndicator(false).color).toBe('warning')
  })

  // El texto acompaña al ícono (tooltip y lector de pantalla): el color solo
  // no basta para quien no distingue colores.
  it('lleva el texto que dice el estado', () => {
    expect(sterilizationIndicator(true).label).toBe('Esterilizado(a)')
    expect(sterilizationIndicator(false).label).toBe('No esterilizado(a)')
  })
})
