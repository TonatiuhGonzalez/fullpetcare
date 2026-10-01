import { describe, expect, it } from 'vitest'

import {
  canRemove,
  computeStock,
  isValidQuantity,
  signedQuantity,
  stockStatus,
  validateMovement,
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
    expect(computeStock([{ quantity: 10 }, { quantity: -2 }, { quantity: -1 }, { quantity: 3 }])).toBe(10)
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
    expect(validateMovement({ type: 'purchase', quantity: 10, currentStock: 0 })).toBeNull()
  })

  it('ajustes y mermas exigen motivo, aunque sea solo espacios', () => {
    // El motivo es lo que permite explicar después por qué cambió la existencia.
    expect(validateMovement({ type: 'loss', quantity: 1, currentStock: 5 })).toBe('Escribe el motivo.')
    expect(
      validateMovement({ type: 'adjustment', quantity: 1, reason: '   ', currentStock: 5 }),
    ).toBe('Escribe el motivo.')
  })

  it('una merma mayor a la existencia se rechaza con el número real', () => {
    // La base también lo rechaza; aquí se avisa antes de enviar, con un mensaje claro.
    expect(
      validateMovement({ type: 'loss', quantity: 6, reason: 'Caducado', currentStock: 5 }),
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
