import { describe, expect, it } from 'vitest'

import { findBySku, normalizeSearch, searchProducts } from './productSearch'

const PRODUCTS = [
  { name: 'Shampóo hipoalergénico', sku: '7501001' },
  { name: 'Alimento adulto 2 kg', sku: '7501002' },
  { name: 'Collar ajustable', sku: null },
  { name: 'Shampoo de avena', sku: 'AVENA-01' },
]

describe('normalizeSearch', () => {
  it('quita acentos, mayúsculas y espacios de los extremos', () => {
    // Qué se rompería: "shampoo" no encontraría "Shampóo" y recepción creería que el
    // producto no existe, aunque esté en el inventario.
    expect(normalizeSearch('  Shampóo ')).toBe('shampoo')
  })
})

describe('findBySku (lector de código de barras)', () => {
  it('encuentra el producto por su código exacto', () => {
    expect(findBySku(PRODUCTS, '7501002')?.name).toBe('Alimento adulto 2 kg')
  })

  it('no confunde un código parcial con uno completo', () => {
    // Qué se rompería: un escaneo cortado ("75010") agregaría al ticket el primer
    // producto que empiece así, y se cobraría algo que el cliente no llevó.
    expect(findBySku(PRODUCTS, '75010')).toBeNull()
  })

  it('ignora mayúsculas y espacios (los lectores a veces agregan un espacio)', () => {
    expect(findBySku(PRODUCTS, ' avena-01 ')?.name).toBe('Shampoo de avena')
  })

  it('con código vacío no devuelve ningún producto, ni siquiera los que no tienen código', () => {
    // Qué se rompería: apretar Enter con el campo vacío agregaría el "Collar" (sku nulo).
    expect(findBySku(PRODUCTS, '')).toBeNull()
    expect(findBySku(PRODUCTS, '   ')).toBeNull()
  })
})

describe('searchProducts (texto)', () => {
  it('encuentra por nombre sin importar acentos ni mayúsculas, conservando el orden', () => {
    expect(searchProducts(PRODUCTS, 'SHAMPOO').map((p) => p.name)).toEqual([
      'Shampóo hipoalergénico',
      'Shampoo de avena',
    ])
  })

  it('también encuentra por una parte del código', () => {
    expect(searchProducts(PRODUCTS, '7501').map((p) => p.sku)).toEqual([
      '7501001',
      '7501002',
    ])
  })

  it('con texto vacío no devuelve nada', () => {
    // Qué se rompería: el diálogo "Consultar precio" pintaría todo el catálogo al abrirse.
    expect(searchProducts(PRODUCTS, '')).toEqual([])
  })

  it('respeta el límite de resultados', () => {
    const many = Array.from({ length: 50 }, (_, i) => ({
      name: `Galleta ${i}`,
      sku: null,
    }))
    expect(searchProducts(many, 'galleta', 5)).toHaveLength(5)
  })

  it('un producto sin código no truena al buscar por texto', () => {
    expect(searchProducts(PRODUCTS, 'collar').map((p) => p.name)).toEqual([
      'Collar ajustable',
    ])
  })
})
