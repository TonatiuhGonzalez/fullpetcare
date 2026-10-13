import { describe, expect, it } from 'vitest'

import {
  CATEGORY_ICONS,
  UNCATEGORIZED_ID,
  groupByCategory,
  isValidCategoryIcon,
  productsInCategory,
  recentlySold,
  validateCategory,
} from './productCategories'

const CATEGORIES = [
  { id: 'c-juguetes', name: 'Juguetes', icon: 'mdi-tennis-ball' },
  { id: 'c-alimento', name: 'Alimento', icon: 'mdi-food-drumstick' },
  { id: 'c-vacia', name: 'Vacía', icon: 'mdi-paw' },
]

const PRODUCTS = [
  { id: 'p1', categoryId: 'c-alimento' },
  { id: 'p2', categoryId: 'c-alimento' },
  { id: 'p3', categoryId: 'c-juguetes' },
  { id: 'p4', categoryId: null },
  // Categoría desactivada u oculta: ya no viene en la lista de categorías.
  { id: 'p5', categoryId: 'c-desactivada' },
]

describe('groupByCategory', () => {
  it('ordena por nombre, cuenta productos y deja "Sin categoría" al final', () => {
    // Qué se rompería: tarjetas en desorden por orden de alta, o "Sin categoría" en medio,
    // y quien cobra tendría que buscar la categoría cada vez en un lugar distinto.
    const tiles = groupByCategory(PRODUCTS, CATEGORIES)
    expect(tiles.map((t) => [t.name, t.count])).toEqual([
      ['Alimento', 2],
      ['Juguetes', 1],
      ['Sin categoría', 2],
    ])
    expect(tiles.at(-1)?.id).toBe(UNCATEGORIZED_ID)
  })

  it('manda a "Sin categoría" a los productos cuya categoría ya no existe', () => {
    // Qué se rompería: al desactivar una categoría, sus productos desaparecerían del punto
    // de venta y no se podrían vender hasta reasignarlos.
    const tiles = groupByCategory([{ categoryId: 'c-desactivada' }], CATEGORIES)
    expect(tiles).toHaveLength(1)
    expect(tiles[0].id).toBe(UNCATEGORIZED_ID)
  })

  it('no muestra categorías sin productos vendibles', () => {
    // Qué se rompería: una tarjeta que al abrirla no trae nada, con el cajero esperando.
    expect(groupByCategory(PRODUCTS, CATEGORIES).some((t) => t.id === 'c-vacia')).toBe(
      false,
    )
  })

  it('sin la tarjeta "Sin categoría" cuando todos los productos tienen una', () => {
    expect(
      groupByCategory([{ categoryId: 'c-alimento' }], CATEGORIES).map((t) => t.id),
    ).toEqual(['c-alimento'])
  })

  it('un catálogo vacío no produce tarjetas', () => {
    expect(groupByCategory([], CATEGORIES)).toEqual([])
  })

  it('un negocio sin categorías muestra todo en "Sin categoría"', () => {
    // Qué se rompería: un negocio que todavía no crea categorías vería el punto de venta vacío.
    const tiles = groupByCategory(PRODUCTS, [])
    expect(tiles).toHaveLength(1)
    expect(tiles[0]).toMatchObject({ id: UNCATEGORIZED_ID, count: 5 })
  })
})

describe('productsInCategory', () => {
  it('devuelve los productos de una categoría real', () => {
    expect(
      productsInCategory(PRODUCTS, CATEGORIES, 'c-alimento').map((p) => p.id),
    ).toEqual(['p1', 'p2'])
  })

  it('"Sin categoría" incluye los nulos y los de categoría desactivada', () => {
    // Debe coincidir con groupByCategory: si la cuenta de la tarjeta dice 2, al abrirla
    // tienen que salir 2.
    expect(
      productsInCategory(PRODUCTS, CATEGORIES, UNCATEGORIZED_ID).map((p) => p.id),
    ).toEqual(['p4', 'p5'])
  })
})

describe('recentlySold', () => {
  const catalog = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]

  it('respeta el orden de la venta más reciente y no repite productos', () => {
    // Qué se rompería: el mismo producto ocupando media fila porque se vendió cinco veces.
    expect(recentlySold(catalog, ['b', 'a', 'b', 'c', 'a'], 10).map((p) => p.id)).toEqual(
      ['b', 'a', 'c'],
    )
  })

  it('omite un producto vendido que ya no está en el catálogo', () => {
    // Qué se rompería: tocar un producto agotado o desactivado y recibir un error al agregarlo.
    expect(recentlySold(catalog, ['zzz', 'a'], 10).map((p) => p.id)).toEqual(['a'])
  })

  it('corta en el límite que cabe en el ancho', () => {
    expect(recentlySold(catalog, ['a', 'b', 'c'], 2).map((p) => p.id)).toEqual(['a', 'b'])
    expect(recentlySold(catalog, ['a'], 0)).toEqual([])
  })

  it('sin ventas devuelve una fila vacía', () => {
    expect(recentlySold(catalog, [], 5)).toEqual([])
  })
})

describe('íconos de categoría', () => {
  it('la lista no repite íconos', () => {
    const icons = CATEGORY_ICONS.map((c) => c.icon)
    expect(new Set(icons).size).toBe(icons.length)
  })

  it('solo acepta íconos de la lista', () => {
    expect(isValidCategoryIcon('mdi-bone')).toBe(true)
    expect(isValidCategoryIcon('mdi-no-existe')).toBe(false)
  })
})

describe('validateCategory', () => {
  it('acepta un nombre con un ícono de la lista', () => {
    expect(validateCategory({ name: 'Juguetes', icon: 'mdi-bone' })).toBeNull()
  })

  it('rechaza el nombre vacío o solo espacios', () => {
    // Qué se rompería: una tarjeta sin nombre en el punto de venta.
    expect(validateCategory({ name: '   ', icon: 'mdi-bone' })).toMatch(/nombre/)
  })

  it('rechaza un nombre demasiado largo', () => {
    // Qué se rompería: la tarjeta de categoría, de ancho fijo, se desbordaría.
    expect(validateCategory({ name: 'x'.repeat(41), icon: 'mdi-bone' })).toMatch(/40/)
  })

  it('rechaza un ícono fuera de la lista', () => {
    expect(validateCategory({ name: 'Juguetes', icon: 'mdi-no-existe' })).toMatch(/ícono/)
  })
})
