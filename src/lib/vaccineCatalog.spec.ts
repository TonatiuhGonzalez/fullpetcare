// Tests de lib/vaccineCatalog.ts (fase 26, tarea 26.11): reglas del catálogo de vacunas.
import { describe, expect, it } from 'vitest'

import {
  intervalLabel,
  intervalProblem,
  isDuplicateVaccine,
  MAX_INTERVAL_DAYS,
  vaccineSpeciesLabel,
} from './vaccineCatalog'

describe('intervalProblem', () => {
  // Qué prueba: que dejar el refuerzo vacío es válido (vacuna de una sola dosis).
  // Qué se rompería: no se podría dar de alta una vacuna sin refuerzo, y la cartilla
  // calcula "próxima dosis" para vacunas que no la tienen.
  it('acepta vacío como "sin refuerzo"', () => {
    expect(intervalProblem(null)).toBeNull()
    expect(intervalProblem('')).toBeNull()
  })

  // Qué prueba: los bordes: 1 día sí, 0 no, decimales no, y el tope exacto sí.
  // Qué se rompería: un 0 o un 365.5 llegaría a `addDays` y la próxima dosis saldría hoy
  // o con una fecha rara, y los recordatorios se dispararían mal.
  it('exige un entero de 1 a 3650', () => {
    expect(intervalProblem(1)).toBeNull()
    expect(intervalProblem(MAX_INTERVAL_DAYS)).toBeNull()
    expect(intervalProblem(0)).not.toBeNull()
    expect(intervalProblem(-5)).not.toBeNull()
    expect(intervalProblem(365.5)).not.toBeNull()
    expect(intervalProblem(MAX_INTERVAL_DAYS + 1)).not.toBeNull()
  })
})

describe('intervalLabel y vaccineSpeciesLabel', () => {
  // Qué prueba: que el nulo se muestra como texto y no como "Cada null días".
  it('muestra "Sin refuerzo" y "Todas las especies" para el nulo', () => {
    expect(intervalLabel(null)).toBe('Sin refuerzo')
    expect(intervalLabel(365)).toBe('Cada 365 días')
    expect(vaccineSpeciesLabel(null)).toBe('Todas las especies')
    expect(vaccineSpeciesLabel('dog')).toBe('Perro')
  })
})

describe('isDuplicateVaccine', () => {
  const existing = [
    { id: 'v1', name: 'Rabia', species: null },
    { id: 'v2', name: 'Polivalente', species: 'dog' as const },
  ]

  // Qué prueba: que "rábia " y "RABIA" cuentan como la misma vacuna.
  // Qué se rompería: el catálogo tendría "Rabia" y "rabia" y la persona elegiría la que no
  // es al registrar la dosis.
  it('detecta el mismo nombre sin importar acentos, mayúsculas ni espacios', () => {
    expect(isDuplicateVaccine(existing, { name: ' rábia ', species: null })).toBe(true)
  })

  // Qué prueba: mismo nombre con otra especie es otra vacuna.
  it('permite el mismo nombre en otra especie', () => {
    expect(isDuplicateVaccine(existing, { name: 'Polivalente', species: 'cat' })).toBe(false)
  })

  // Qué prueba: al editar una vacuna sin cambiar su nombre no choca consigo misma.
  // Qué se rompería: no se podría cambiar solo el refuerzo de una vacuna ya existente.
  it('ignora la propia vacuna al editar', () => {
    expect(isDuplicateVaccine(existing, { name: 'Rabia', species: null }, 'v1')).toBe(false)
  })
})
