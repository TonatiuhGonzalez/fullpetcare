// Búsqueda de productos en el punto de venta (fase 13, tarea 13.4). Funciones puras:
// reciben la lista de productos ya cargada y devuelven cuáles coinciden. Sin red.
//
// Solo queda la búsqueda por CÓDIGO (findBySku): lo que escribe un lector de código de
// barras. Debe ser una coincidencia EXACTA; si fuera "contiene", escanear "75010" podría
// agregar el producto equivocado, y tiene que responder al instante (sin red).
//
// La búsqueda por TEXTO (lo que teclea una persona: "shampoo" encuentra "Shampóo
// hipoalergénico") ya no vive aquí: la decide la base con `search_products()` (C1.20), para
// que Inventario y el punto de venta digan lo mismo y la ñ no se confunda con la n.
//
// El código de barras vive en `products.sku`, el código interno opcional del negocio.

import { normalizeSearchText } from './searchText'

interface Searchable {
  sku: string | null
}

/** Minúsculas, sin acentos y sin espacios en los extremos: "  Shampóo " → "shampoo". */
export const normalizeSearch = normalizeSearchText

/** El producto cuyo código coincide EXACTAMENTE (sin importar mayúsculas), o null. */
export function findBySku<T extends Searchable>(products: T[], code: string): T | null {
  const wanted = normalizeSearch(code)
  if (!wanted) return null
  return products.find((p) => p.sku !== null && normalizeSearch(p.sku) === wanted) ?? null
}
