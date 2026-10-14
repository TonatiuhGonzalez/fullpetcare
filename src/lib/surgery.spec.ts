// Tests de lib/surgery.ts (fase 32, tarea 32.4): totales y validación de renglones de cirugía.
import { describe, expect, it } from 'vitest'

import {
  surgeryLinesProblem,
  surgeryTaxCents,
  surgeryTotalCents,
  toRpcLines,
  type SurgeryLineDraft,
} from './surgery'

function line(overrides: Partial<SurgeryLineDraft> = {}): SurgeryLineDraft {
  return {
    key: 'k',
    kind: 'fee',
    productId: null,
    description: 'Honorarios',
    quantity: 1,
    unitPriceCents: 150000,
    taxRateBp: 1600,
    isBillable: true,
    unit: 'package',
    ...overrides,
  }
}

describe('surgeryTotalCents', () => {
  // Qué prueba: el total es la suma de precio × cantidad de cada renglón cobrable.
  // Qué se rompería: la pantalla mostraría un total distinto al que cobra la base.
  it('suma precio por cantidad de los renglones cobrables', () => {
    const lines = [
      line(),
      line({ kind: 'consumable', quantity: 3, unitPriceCents: 8000 }),
    ]
    expect(surgeryTotalCents(lines)).toBe(150000 + 24000)
  })

  // Qué prueba: un renglón de uso interno no suma al total.
  it('no suma los renglones de uso interno', () => {
    expect(
      surgeryTotalCents([line(), line({ isBillable: false, unitPriceCents: 99999 })]),
    ).toBe(150000)
  })

  // Qué prueba: sin renglones el total es 0, no NaN.
  it('sin renglones es 0', () => {
    expect(surgeryTotalCents([])).toBe(0)
  })
})

describe('surgeryTaxCents', () => {
  // Qué prueba: el IVA se desglosa por renglón y luego se suma (no sobre el total): $1,160.00
  // con IVA al 16 % contienen $160.00; y un renglón con tasa 0 no aporta.
  it('desglosa el IVA por renglón', () => {
    expect(surgeryTaxCents([line({ unitPriceCents: 116000 })])).toBe(16000)
    expect(
      surgeryTaxCents([line({ unitPriceCents: 116000 }), line({ taxRateBp: 0 })]),
    ).toBe(16000)
  })
})

describe('surgeryLinesProblem', () => {
  it('acepta renglones completos', () => {
    expect(surgeryLinesProblem([line()])).toBeNull()
  })

  // Qué prueba: cada regla de forma, con el número de renglón en el mensaje.
  // Qué se rompería: la base rechazaría con un mensaje que no dice qué renglón es.
  it('señala el primer renglón inválido', () => {
    expect(surgeryLinesProblem([])).not.toBeNull()
    expect(surgeryLinesProblem([line(), line({ description: '  ' })])).toContain('2')
    expect(surgeryLinesProblem([line({ quantity: 0 })])).toContain('cantidad')
    expect(surgeryLinesProblem([line({ unitPriceCents: -1 })])).toContain('precio')
    expect(surgeryLinesProblem([line({ productId: 'p1' })])).toContain('honorario')
  })

  // Qué prueba: precio 0 es válido (un renglón de cortesía).
  it('acepta precio 0', () => {
    expect(surgeryLinesProblem([line({ unitPriceCents: 0 })])).toBeNull()
  })
})

describe('toRpcLines', () => {
  it('recorta la descripción y pasa los nombres de la base', () => {
    expect(
      toRpcLines([
        line({ description: ' Sutura ', kind: 'consumable', productId: 'p1' }),
      ])[0],
    ).toEqual({
      kind: 'consumable',
      product_id: 'p1',
      description: 'Sutura',
      quantity: 1,
      unit_price_cents: 150000,
      tax_rate_bp: 1600,
      is_billable: true,
      unit: 'package',
    })
  })
})
