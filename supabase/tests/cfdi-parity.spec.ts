// La Edge Function `invoicing` usa una COPIA de lib/cfdi.ts (ver el encabezado de
// supabase/functions/_shared/cfdi.ts). Este test corre las mismas entradas por
// las dos y exige el mismo resultado: si alguien cambia una y olvida la otra,
// la factura timbrada no coincidiría con la vista previa que ve quien factura.
import { describe, expect, it } from 'vitest'

import { buildCfdi as libBuild } from '@/lib/cfdi'
import { buildCfdi as functionBuild } from '../functions/_shared/cfdi'

const RECEIVER = {
  rfc: 'rucs850312ab1',
  legalName: 'Sofía Ruiz',
  taxRegimeCode: '612',
  postalCode: '97000',
  cfdiUse: null,
}
const base = { description: 'x', satProductCode: '70122000', satUnitCode: 'E48' }

// Generador determinista (sin Math.random) para que un fallo sea reproducible.
function* cases() {
  let seed = 12345
  const next = (n: number) => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    return seed % n
  }
  for (let i = 0; i < 300; i++) {
    const items = Array.from({ length: 1 + next(4) }, () => ({
      ...base,
      quantity: 1 + next(5),
      unitPriceCents: next(50000),
      taxRateBp: next(3) === 0 ? 0 : 1600,
    }))
    const gross = items.reduce((s, it) => s + it.unitPriceCents * it.quantity, 0)
    yield { items, discount: gross === 0 ? 0 : next(gross + 1) }
  }
}

describe('cfdi: la copia de la Edge Function es idéntica a lib/cfdi.ts', () => {
  it('da el mismo resultado en 300 ventas generadas (con descuento y mezcla de tasas)', () => {
    const payments = [
      { amountCents: 100, paymentFormCode: '01' },
      { amountCents: 900, paymentFormCode: '28' },
    ]
    for (const { items, discount } of cases()) {
      expect(functionBuild(items, payments, discount, RECEIVER)).toEqual(
        libBuild(items, payments, discount, RECEIVER),
      )
    }
  })

  it('da los mismos problemas cuando faltan datos del cliente', () => {
    const empty = {
      rfc: '',
      legalName: '',
      taxRegimeCode: null,
      postalCode: '1',
      cfdiUse: null,
    }
    expect(functionBuild([], [], 0, empty)).toEqual(libBuild([], [], 0, empty))
  })
})
