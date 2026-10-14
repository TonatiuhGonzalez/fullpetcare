// Tests de lib/suppliers.ts (fase 29B, tarea 29.3): reglas del catálogo de proveedores.
import { describe, expect, it } from 'vitest'

import { isDuplicateSupplier, supplierProblems, supplierTypeLabel } from './suppliers'

describe('supplierProblems', () => {
  // Qué prueba: que teléfono y correo son opcionales (un proveedor sin ellos es válido).
  // Qué se rompería: no se podría dar de alta a un proveedor del que solo se sabe el nombre.
  it('acepta teléfono y correo vacíos', () => {
    expect(supplierProblems({})).toEqual([])
    expect(supplierProblems({ phone: '  ', email: '' })).toEqual([])
  })

  // Qué prueba: si se escriben, deben tener forma válida; un teléfono corto es el error
  // de captura más común.
  it('señala un teléfono o un correo mal formados', () => {
    expect(supplierProblems({ phone: '55512' })).toHaveLength(1)
    expect(supplierProblems({ email: 'ventas' })).toHaveLength(1)
    expect(
      supplierProblems({ phone: '5551234567', email: 'ventas@proveedor.mx' }),
    ).toEqual([])
  })
})

describe('isDuplicateSupplier', () => {
  const existing = [{ id: 's1', name: 'Distribuidora Vetérinaria del Norte' }]

  // Qué prueba: mismo proveedor escrito con otros acentos, mayúsculas o espacios.
  // Qué se rompería: el catálogo tendría dos veces al mismo proveedor y los productos
  // quedarían repartidos entre las dos.
  it('detecta el mismo nombre sin importar acentos, mayúsculas ni espacios', () => {
    expect(isDuplicateSupplier(existing, ' distribuidora veterinaria DEL norte ')).toBe(
      true,
    )
  })

  it('no choca consigo mismo al editar', () => {
    expect(
      isDuplicateSupplier(existing, 'Distribuidora Vetérinaria del Norte', 's1'),
    ).toBe(false)
  })
})

describe('supplierTypeLabel', () => {
  it('muestra el tipo en español', () => {
    expect(supplierTypeLabel('medication')).toBe('Medicamentos')
    expect(supplierTypeLabel('other')).toBe('Otro')
  })
})
