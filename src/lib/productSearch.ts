// Búsqueda de productos en el punto de venta (fase 13, tarea 13.4). Funciones puras:
// reciben la lista de productos ya cargada y devuelven cuáles coinciden. Sin red.
//
// Hay dos formas de buscar, y no son lo mismo:
//   - Por CÓDIGO (findBySku): lo que escribe un lector de código de barras. Debe ser
//     una coincidencia EXACTA; si fuera "contiene", escanear "75010" podría agregar
//     el producto equivocado.
//   - Por TEXTO (searchProducts): lo que teclea una persona. Tolera mayúsculas y
//     acentos ("shampoo" encuentra "Shampóo hipoalergénico") y busca por nombre o código.
//
// El código de barras vive en `products.sku`, el código interno opcional del negocio.

interface Searchable {
  name: string
  sku: string | null
}

/** Minúsculas, sin acentos y sin espacios en los extremos: "  Shampóo " → "shampoo". */
export function normalizeSearch(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
}

/** El producto cuyo código coincide EXACTAMENTE (sin importar mayúsculas), o null. */
export function findBySku<T extends Searchable>(products: T[], code: string): T | null {
  const wanted = normalizeSearch(code)
  if (!wanted) return null
  return products.find((p) => p.sku !== null && normalizeSearch(p.sku) === wanted) ?? null
}

/**
 * Productos cuyo nombre o código CONTIENEN el texto, en el orden recibido. Con texto
 * vacío no devuelve nada (en vez de toda la lista) para que la pantalla no pinte
 * cientos de filas antes de que alguien escriba.
 */
export function searchProducts<T extends Searchable>(
  products: T[],
  query: string,
  limit = 20,
): T[] {
  const wanted = normalizeSearch(query)
  if (!wanted) return []
  return products
    .filter(
      (p) =>
        normalizeSearch(p.name).includes(wanted) ||
        (p.sku !== null && normalizeSearch(p.sku).includes(wanted)),
    )
    .slice(0, limit)
}

/**
 * Lo que muestra la cuadrícula del punto de venta: con texto vacío, TODO el catálogo
 * (a diferencia de searchProducts, que no devuelve nada); con texto, los que coinciden
 * por nombre o código, sin límite (la cuadrícula hace scroll).
 */
export function filterProducts<T extends Searchable>(products: T[], query: string): T[] {
  if (!normalizeSearch(query)) return products
  return searchProducts(products, query, products.length)
}
