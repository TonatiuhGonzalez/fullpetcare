// Tests de lib/fractional.ts (fase 29C, tarea 29.5): precio de la unidad, existencia y envase abierto.
import { describe, expect, it } from 'vitest'

import {
  baseUnits,
  formatStock,
  isFractional,
  openPackage,
  presentationProblem,
  priceForUnit,
  splitStock,
  unitPriceCents,
} from './fractional'

const caja20 = {
  unitsPerPackage: 20,
  packageName: 'caja',
  unitName: 'tableta',
  unitPriceCents: null,
}

describe('unitPriceCents', () => {
  // Qué prueba: el caso normal: $145.00 entre 20 tabletas = $7.25.
  it('divide el precio del envase entre sus unidades', () => {
    expect(unitPriceCents(14500, caja20)).toBe(725)
  })

  // Qué prueba: el borde del redondeo: $100.00 entre 3 no da un entero y se redondea al
  // centavo más cercano (3333 × 3 = 9999, un centavo menos que el envase).
  // Qué se rompería: un precio con fracciones de centavo rompería el dinero entero (§8.2).
  it('redondea al centavo más cercano', () => {
    expect(unitPriceCents(10000, { unitsPerPackage: 3, unitPriceCents: null })).toBe(3333)
    expect(unitPriceCents(10000, { unitsPerPackage: 6, unitPriceCents: null })).toBe(1667)
  })

  // Qué prueba: el precio fijado en el producto manda sobre el cálculo, incluso si es 0.
  it('usa el precio fijado en el producto, aunque sea 0', () => {
    expect(unitPriceCents(14500, { ...caja20, unitPriceCents: 800 })).toBe(800)
    expect(unitPriceCents(14500, { ...caja20, unitPriceCents: 0 })).toBe(0)
  })

  // Qué prueba: precio 0 del envase da 0, no NaN.
  it('con precio 0 da 0', () => {
    expect(unitPriceCents(0, caja20)).toBe(0)
  })
})

describe('priceForUnit y baseUnits', () => {
  it('el envase cobra el precio del envase y baja todas sus unidades', () => {
    expect(priceForUnit('package', 14500, caja20)).toBe(14500)
    expect(baseUnits(2, 'package', caja20)).toBe(40)
  })

  it('la unidad cobra el precio de la unidad y baja una por una', () => {
    expect(priceForUnit('unit', 14500, caja20)).toBe(725)
    expect(baseUnits(3, 'unit', caja20)).toBe(3)
  })
})

describe('splitStock y openPackage', () => {
  // Qué prueba: 63 tabletas son 3 cajas y 3 sueltas; la abierta tiene 3 y ya se usaron 17.
  // Qué se rompería: el inventario no mostraría que hay una caja abierta ni cuánto queda.
  it('reparte la existencia en envases y sueltas y deriva el envase abierto', () => {
    expect(splitStock(63, caja20)).toEqual({ packages: 3, loose: 3 })
    expect(openPackage(63, caja20)).toEqual({ isOpen: true, remaining: 3, used: 17 })
  })

  // Qué prueba: justo en un múltiplo no hay envase abierto (todos están cerrados).
  it('sin sobrante no hay envase abierto', () => {
    expect(openPackage(60, caja20)).toEqual({ isOpen: false, remaining: 0, used: 0 })
  })

  // Qué prueba: un producto sin fraccionar o sin existencia nunca tiene envase abierto.
  it('un producto sin fraccionar o sin existencia no tiene envase abierto', () => {
    expect(openPackage(7, { unitsPerPackage: 1 })).toEqual({
      isOpen: false,
      remaining: 0,
      used: 0,
    })
    expect(openPackage(0, caja20).isOpen).toBe(false)
  })
})

describe('formatStock', () => {
  it('sin fraccionar mantiene el texto de siempre', () => {
    expect(
      formatStock(5, { unitsPerPackage: 1, packageName: null, unitName: null }),
    ).toBe('5 en existencia')
  })

  // Qué prueba: singular y plural, y que 0 envases o 0 sueltas no se escriben.
  it('muestra las unidades y su reparto', () => {
    expect(formatStock(63, caja20)).toBe('63 tabletas · 3 cajas y 3 sueltas')
    expect(formatStock(21, caja20)).toBe('21 tabletas · 1 caja y 1 suelta')
    expect(formatStock(40, caja20)).toBe('40 tabletas · 2 cajas')
    expect(formatStock(1, caja20)).toBe('1 tableta · 1 suelta')
  })
})

describe('presentationProblem / isFractional', () => {
  const ok = {
    unitsPerPackage: 20,
    unitName: 'tableta',
    unitPriceCents: null,
    unitSatCode: 'H87',
  }

  it('acepta una presentación completa', () => {
    expect(presentationProblem(ok)).toBeNull()
    expect(isFractional(caja20)).toBe(true)
    expect(isFractional({ unitsPerPackage: 1 })).toBe(false)
  })

  // Qué prueba: los bordes: 1 (no se fracciona, válido sin nombre), 10000 sí, 10001 no,
  // decimales y 0 no.
  it('valida los bordes de unidades por envase', () => {
    expect(presentationProblem({ ...ok, unitsPerPackage: 1, unitName: '' })).toBeNull()
    expect(presentationProblem({ ...ok, unitsPerPackage: 10000 })).toBeNull()
    expect(presentationProblem({ ...ok, unitsPerPackage: 10001 })).not.toBeNull()
    expect(presentationProblem({ ...ok, unitsPerPackage: 2.5 })).not.toBeNull()
    expect(presentationProblem({ ...ok, unitsPerPackage: 0 })).not.toBeNull()
  })

  // Qué prueba: fraccionar exige nombre de la unidad (el ticket diría "Amoxicilina ()").
  it('exige el nombre de la unidad al fraccionar', () => {
    expect(presentationProblem({ ...ok, unitName: '  ' })).toMatch(/cómo se llama/i)
  })

  it('valida el precio y la clave de unidad', () => {
    expect(presentationProblem({ ...ok, unitPriceCents: -1 })).not.toBeNull()
    expect(presentationProblem({ ...ok, unitPriceCents: 0 })).toBeNull()
    expect(presentationProblem({ ...ok, unitSatCode: 'h' })).not.toBeNull()
    expect(presentationProblem({ ...ok, unitSatCode: '' })).toBeNull()
  })
})
