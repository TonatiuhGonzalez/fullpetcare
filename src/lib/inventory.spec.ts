import { describe, expect, it } from 'vitest'

import {
  buildInventoryTableRows,
  canRemove,
  compareOptionalText,
  computeStock,
  isValidQuantity,
  signedQuantity,
  stockStatus,
  validateMovement,
  validateProduct,
  type ProductInput,
} from './inventory'

describe('computeStock', () => {
  it('sin movimientos la existencia es 0, no NaN', () => {
    // Un producto recién dado de alta no tiene historial. Si esto regresara
    // undefined/NaN, la lista de Inventario mostraría "NaN" en cada producto nuevo.
    expect(computeStock([])).toBe(0)
  })

  it('suma compras, ventas, ajustes y mermas con su signo', () => {
    // La existencia es la suma de la bitácora: +10 compra, -2 venta, -1 merma,
    // +3 ajuste = 10. Si el signo se perdiera, el conteo se descuadraría.
    expect(
      computeStock([
        { quantity: 10 },
        { quantity: -2 },
        { quantity: -1 },
        { quantity: 3 },
      ]),
    ).toBe(10)
  })
})

describe('stockStatus', () => {
  it('existencia exactamente igual al mínimo ya es "stock bajo"', () => {
    // La regla es `<=`, no `<`: con mínimo 5 y 5 piezas hay que avisar, porque
    // la siguiente venta lo deja bajo el mínimo. Con `<` se avisaría tarde.
    expect(stockStatus(5, 5)).toBe('low')
    expect(stockStatus(6, 5)).toBe('ok')
  })

  it('existencia 0 es "sin inventario" aunque también esté bajo el mínimo', () => {
    // "Sin inventario" bloquea la venta; "stock bajo" solo avisa. Si ganara
    // "bajo", el mostrador creería que aún puede vender.
    expect(stockStatus(0, 5)).toBe('out')
  })

  it('con mínimo 0 solo avisa al llegar a 0', () => {
    // Un negocio que no definió mínimo no quiere alertas de "poco": 1 pieza es 'ok'.
    expect(stockStatus(1, 0)).toBe('ok')
    expect(stockStatus(0, 0)).toBe('out')
  })

  it('una existencia negativa (dato corrupto) se trata como sin inventario', () => {
    // La base no deja llegar a negativo, pero si un dato malo se colara, la
    // pantalla debe mostrar "Sin inventario" y no un número raro.
    expect(stockStatus(-2, 3)).toBe('out')
  })
})

describe('isValidQuantity', () => {
  it('solo acepta enteros mayores a 0', () => {
    // Decisión #6: nada de fracciones. 0 y negativos no son una cantidad
    // (el signo lo pone el tipo de movimiento); NaN vendría de un campo vacío.
    expect(isValidQuantity(1)).toBe(true)
    expect(isValidQuantity(0)).toBe(false)
    expect(isValidQuantity(-3)).toBe(false)
    expect(isValidQuantity(1.5)).toBe(false)
    expect(isValidQuantity(Number.NaN)).toBe(false)
  })
})

describe('canRemove', () => {
  it('permite sacar justo lo que hay y deja la existencia en 0', () => {
    // Borde: vender la última pieza es válido. Con `>` en vez de `>=` no se
    // podría vender la última.
    expect(canRemove(3, 3)).toBe(true)
  })

  it('no permite sacar más de lo que hay ni con existencia 0', () => {
    // Es la regla "con existencia 0 no se vende ni se consume".
    expect(canRemove(2, 3)).toBe(false)
    expect(canRemove(0, 1)).toBe(false)
  })

  it('rechaza cantidades 0 o negativas', () => {
    // Sacar -2 "piezas" sería meter 2: una puerta trasera para inflar la existencia.
    expect(canRemove(10, 0)).toBe(false)
    expect(canRemove(10, -2)).toBe(false)
  })
})

describe('signedQuantity', () => {
  it('compra suma, merma resta y el ajuste depende de la dirección', () => {
    // Si una merma se guardara en positivo, "perder" mercancía la aumentaría.
    expect(signedQuantity('purchase', 4)).toBe(4)
    expect(signedQuantity('loss', 4)).toBe(-4)
    expect(signedQuantity('adjustment', 4, 'in')).toBe(4)
    expect(signedQuantity('adjustment', 4, 'out')).toBe(-4)
  })
})

describe('validateMovement', () => {
  it('una compra válida no necesita motivo', () => {
    // El motivo solo es obligatorio en ajustes y mermas; pedirlo en cada
    // compra haría tedioso el caso más común.
    expect(
      validateMovement({ type: 'purchase', quantity: 10, currentStock: 0 }),
    ).toBeNull()
  })

  it('ajustes y mermas exigen motivo, aunque sea solo espacios', () => {
    // El motivo es lo que permite explicar después por qué cambió la existencia.
    expect(validateMovement({ type: 'loss', quantity: 1, currentStock: 5 })).toBe(
      'Escribe el motivo.',
    )
    expect(
      validateMovement({
        type: 'adjustment',
        quantity: 1,
        reason: '   ',
        currentStock: 5,
      }),
    ).toBe('Escribe el motivo.')
  })

  it('una merma mayor a la existencia se rechaza con el número real', () => {
    // La base también lo rechaza; aquí se avisa antes de enviar, con un mensaje claro.
    expect(
      validateMovement({
        type: 'loss',
        quantity: 6,
        reason: 'Caducado',
        currentStock: 5,
      }),
    ).toBe('No hay existencia suficiente: hay 5.')
  })

  it('un ajuste hacia arriba no se limita por la existencia', () => {
    // Contar de más en el almacén es válido aunque la existencia fuera 0.
    expect(
      validateMovement({
        type: 'adjustment',
        quantity: 4,
        direction: 'in',
        reason: 'Conteo físico',
        currentStock: 0,
      }),
    ).toBeNull()
  })

  it('cantidad 0 o decimal se rechaza antes de revisar lo demás', () => {
    expect(validateMovement({ type: 'purchase', quantity: 0, currentStock: 0 })).toBe(
      'La cantidad debe ser un número entero mayor a 0.',
    )
    expect(validateMovement({ type: 'purchase', quantity: 2.5, currentStock: 0 })).toBe(
      'La cantidad debe ser un número entero mayor a 0.',
    )
  })
})

describe('validateProduct', () => {
  const valid: ProductInput = {
    name: 'Shampoo hipoalergénico',
    priceCents: 18900,
    costCents: null,
    minStock: 0,
    satProductCode: '01010101',
    satUnitCode: 'H87',
    categoryId: null,
  }

  it('acepta precio 0, costo vacío y mínimo 0', () => {
    // Son bordes válidos: un regalo sin precio, un negocio que no captura costo
    // y otro que no quiere aviso de stock bajo. Rechazarlos bloquearía altas legítimas.
    expect(validateProduct(valid)).toBeNull()
    expect(validateProduct({ ...valid, priceCents: 0 })).toBeNull()
  })

  it('rechaza un nombre vacío o de solo espacios', () => {
    // Un producto sin nombre sería una fila en blanco en la lista y en el ticket.
    expect(validateProduct({ ...valid, name: '   ' })).toBe(
      'Escribe el nombre del producto.',
    )
  })

  it('rechaza precio o costo negativo y mínimo decimal o negativo', () => {
    // Todo es entero (§8.2): 12.5 piezas o -1 centavos romperían el cálculo de
    // alertas y el IVA por partida.
    expect(validateProduct({ ...valid, priceCents: -1 })).toBe(
      'El precio debe ser 0 o mayor.',
    )
    expect(validateProduct({ ...valid, costCents: -5 })).toBe(
      'El costo debe ser 0 o mayor.',
    )
    expect(validateProduct({ ...valid, minStock: 2.5 })).toBe(
      'El mínimo debe ser un número entero, 0 o mayor.',
    )
    expect(validateProduct({ ...valid, minStock: -1 })).toBe(
      'El mínimo debe ser un número entero, 0 o mayor.',
    )
  })

  it('rechaza claves del SAT con formato inválido', () => {
    // La base las rechazaría con un error críptico; aquí se avisa claro y antes.
    expect(validateProduct({ ...valid, satProductCode: '1234' })).toBe(
      'La clave de producto del SAT debe tener 8 dígitos.',
    )
    expect(validateProduct({ ...valid, satUnitCode: 'X' })).toBe(
      'La clave de unidad del SAT debe tener 2 o 3 caracteres.',
    )
  })
})

describe('buildInventoryTableRows', () => {
  const base = {
    id: 'p1',
    name: 'Shampoo',
    sku: null,
    price_cents: 12500,
    is_active: true,
    category_id: null,
  }

  it('resuelve la categoría por id y deja null si no tiene o ya no existe', () => {
    // Un producto con categoría borrada o sin ella debe quedar como "Sin categoría";
    // si no, la tabla mostraría "undefined" o rompería al ordenar por categoría.
    const rows = buildInventoryTableRows(
      [
        { product: { ...base, id: 'a', category_id: 'c1' }, stock: 3, status: 'ok' },
        { product: { ...base, id: 'b', category_id: 'borrada' }, stock: 0, status: 'out' },
        { product: { ...base, id: 'c' }, stock: 1, status: 'low' },
      ],
      [{ id: 'c1', name: 'Higiene' }],
    )
    expect(rows.map((r) => r.categoryName)).toEqual(['Higiene', null, null])
  })

  it('conserva precio en centavos, existencia y estado para ordenar por valor', () => {
    // Ordenar por precio debe usar el entero, no el texto "$125.00"; si se ordenara
    // el texto, "$1,000.00" quedaría antes que "$250.00".
    const [row] = buildInventoryTableRows(
      [{ product: { ...base, is_active: false }, stock: 7, status: 'ok' }],
      [],
    )
    expect(row).toMatchObject({ priceCents: 12500, stock: 7, status: 'ok', isActive: false })
  })

  it('sin productos regresa una lista vacía', () => {
    // Un negocio nuevo no tiene productos: la tabla debe poder armarse con 0 filas.
    expect(buildInventoryTableRows([], [])).toEqual([])
  })
})

describe('compareOptionalText', () => {
  it('ordena sin distinguir mayúsculas ni acentos', () => {
    // "álamo" y "Bolsa" deben ordenarse como a < b; con un orden por código "á" caería al final.
    expect(compareOptionalText('álamo', 'Bolsa')).toBeLessThan(0)
    expect(compareOptionalText('Bolsa', 'álamo')).toBeGreaterThan(0)
  })

  it('manda los vacíos al final al ordenar ascendente', () => {
    // Productos sin clave o sin categoría no deben encabezar la lista al ordenar A-Z.
    expect(['b', null, 'a', ''].sort(compareOptionalText)).toEqual(['a', 'b', null, ''])
  })

  it('dos vacíos son iguales', () => {
    // null y "" significan lo mismo ("sin valor"); si no fueran iguales, el orden sería inestable.
    expect(compareOptionalText(null, '  ')).toBe(0)
  })
})
