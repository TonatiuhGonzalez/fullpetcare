// Tests de lib/prescription.ts (fase 28, tarea 28.5): validación y formato de la receta.
import { describe, expect, it } from 'vitest'

import {
  MAX_PRESCRIPTION_ITEMS,
  prescriptionFolioLabel,
  prescriptionPages,
  prescriptionProblem,
  toRpcItems,
  type PrescriptionDraftItem,
} from './prescription'

function item(overrides: Partial<PrescriptionDraftItem> = {}): PrescriptionDraftItem {
  return {
    key: 'k',
    productId: null,
    medicationName: 'Amoxicilina',
    dose: '1 tableta',
    frequency: 'Cada 12 horas',
    duration: '7 días',
    ...overrides,
  }
}

describe('prescriptionProblem', () => {
  // Qué prueba: una receta sin medicamentos no se guarda.
  // Qué se rompería: se imprimiría una hoja con firma y cédula pero sin nada recetado.
  it('rechaza una receta vacía', () => {
    expect(prescriptionProblem([])).not.toBeNull()
  })

  // Qué prueba: un renglón con el nombre en blanco (solo espacios) se señala por posición.
  it('señala el medicamento sin nombre', () => {
    const problem = prescriptionProblem([item(), item({ medicationName: '   ' })])
    expect(problem).toContain('2')
  })

  // Qué prueba: el borde del tope (30 sí, 31 no), el mismo que revalida la base.
  it('acepta hasta 30 medicamentos y rechaza 31', () => {
    const many = (n: number) => Array.from({ length: n }, () => item())
    expect(prescriptionProblem(many(MAX_PRESCRIPTION_ITEMS))).toBeNull()
    expect(prescriptionProblem(many(MAX_PRESCRIPTION_ITEMS + 1))).not.toBeNull()
  })

  // Qué prueba: dosis, frecuencia y duración son opcionales (un medicamento "según
  // indicación" no tiene frecuencia fija).
  it('no exige dosis, frecuencia ni duración', () => {
    expect(
      prescriptionProblem([item({ dose: '', frequency: '', duration: '' })]),
    ).toBeNull()
  })
})

describe('toRpcItems', () => {
  // Qué prueba: que los espacios se recortan y los vacíos viajan como nulos.
  // Qué se rompería: la base guardaría "" y la hoja imprimiría celdas con espacios.
  it('recorta y deja los vacíos como nulos', () => {
    const [row] = toRpcItems([
      item({ medicationName: ' Meloxicam ', dose: '  ', duration: '5 días ' }),
    ])
    expect(row).toEqual({
      product_id: null,
      medication_name: 'Meloxicam',
      dose: null,
      frequency: 'Cada 12 horas',
      duration: '5 días',
    })
  })

  // Qué prueba: que el producto del catálogo se conserva.
  it('conserva el producto del catálogo', () => {
    expect(toRpcItems([item({ productId: 'p1' })])[0].product_id).toBe('p1')
  })
})

describe('prescriptionFolioLabel y prescriptionPages', () => {
  it('rellena el folio con ceros', () => {
    expect(prescriptionFolioLabel(7)).toBe('No. 000007')
    expect(prescriptionFolioLabel(123456)).toBe('No. 123456')
  })

  // Qué prueba: 10 caben en una hoja, 11 pasan a la segunda, y 0 cuenta como una hoja.
  it('calcula las hojas: 10 por hoja', () => {
    expect(prescriptionPages(0)).toBe(1)
    expect(prescriptionPages(10)).toBe(1)
    expect(prescriptionPages(11)).toBe(2)
  })
})
