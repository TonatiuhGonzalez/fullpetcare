// Categorías de producto en el punto de venta (fase 13, extensión 13G). Funciones puras:
// reciben el catálogo y las categorías ya cargados y devuelven qué mostrar. Sin red.

/** Íconos que se pueden elegir para una categoría (Material Design). La base solo valida la forma. */
export const CATEGORY_ICONS: { icon: string; label: string }[] = [
  { icon: 'mdi-food-drumstick', label: 'Alimento' },
  { icon: 'mdi-bowl-mix', label: 'Comedero' },
  { icon: 'mdi-sack', label: 'Costal' },
  { icon: 'mdi-bone', label: 'Hueso' },
  { icon: 'mdi-food-apple', label: 'Premios' },
  { icon: 'mdi-fish', label: 'Pescado' },
  { icon: 'mdi-tennis-ball', label: 'Juguetes' },
  { icon: 'mdi-toy-brick', label: 'Juegos' },
  { icon: 'mdi-shower-head', label: 'Higiene' },
  { icon: 'mdi-spray-bottle', label: 'Limpieza' },
  { icon: 'mdi-content-cut', label: 'Estética' },
  { icon: 'mdi-water', label: 'Baño' },
  { icon: 'mdi-pill', label: 'Medicamento' },
  { icon: 'mdi-bottle-tonic-plus', label: 'Suplementos' },
  { icon: 'mdi-medical-bag', label: 'Salud' },
  { icon: 'mdi-dog-service', label: 'Accesorios' },
  { icon: 'mdi-link-variant', label: 'Correas' },
  { icon: 'mdi-tshirt-crew', label: 'Ropa' },
  { icon: 'mdi-bed', label: 'Camas' },
  { icon: 'mdi-bag-personal', label: 'Transporte' },
  { icon: 'mdi-dog', label: 'Perros' },
  { icon: 'mdi-cat', label: 'Gatos' },
  { icon: 'mdi-bird', label: 'Aves' },
  { icon: 'mdi-paw', label: 'General' },
]

/** Ícono por omisión al crear una categoría. */
export const DEFAULT_CATEGORY_ICON = 'mdi-paw'

/** Id de la tarjeta que junta los productos sin categoría (no es un id real de la base). */
export const UNCATEGORIZED_ID = 'uncategorized'

/** Ícono de la tarjeta "Sin categoría". */
export const UNCATEGORIZED_ICON = 'mdi-package-variant'

export function isValidCategoryIcon(icon: string): boolean {
  return CATEGORY_ICONS.some((c) => c.icon === icon)
}

interface CategoryLike {
  id: string
  name: string
  icon: string
}

interface ProductLike {
  categoryId: string | null
}

export interface CategoryTile {
  id: string
  name: string
  icon: string
  /** Productos vendibles que trae. */
  count: number
}

/**
 * La categoría REAL de un producto, o null. Una categoría que no está en la lista (desactivada
 * u oculta) cuenta como "sin categoría": sus productos no se pierden, pasan a esa tarjeta.
 */
function realCategoryId(product: ProductLike, categories: CategoryLike[]): string | null {
  return categories.some((c) => c.id === product.categoryId) ? product.categoryId : null
}

/**
 * Las tarjetas de la fila superior: una por categoría que tenga al menos un producto (una
 * categoría vacía no deja vender nada), ordenadas por nombre, y al final "Sin categoría"
 * solo si hay productos sin ella.
 */
export function groupByCategory(
  products: ProductLike[],
  categories: CategoryLike[],
): CategoryTile[] {
  const counts = new Map<string | null, number>()
  for (const product of products) {
    const id = realCategoryId(product, categories)
    counts.set(id, (counts.get(id) ?? 0) + 1)
  }

  const tiles: CategoryTile[] = categories
    .filter((c) => (counts.get(c.id) ?? 0) > 0)
    .map((c) => ({ id: c.id, name: c.name, icon: c.icon, count: counts.get(c.id)! }))
    .sort((a, b) => a.name.localeCompare(b.name, 'es'))

  const uncategorized = counts.get(null) ?? 0
  if (uncategorized > 0) {
    tiles.push({
      id: UNCATEGORIZED_ID,
      name: 'Sin categoría',
      icon: UNCATEGORIZED_ICON,
      count: uncategorized,
    })
  }
  return tiles
}

/** Los productos de una tarjeta de categoría (`UNCATEGORIZED_ID` para los que no tienen). */
export function productsInCategory<T extends ProductLike>(
  products: T[],
  categories: CategoryLike[],
  categoryId: string,
): T[] {
  return products.filter((p) => {
    const id = realCategoryId(p, categories)
    return categoryId === UNCATEGORIZED_ID ? id === null : id === categoryId
  })
}

/**
 * Fila inferior: los productos vendidos más recientemente. `soldProductIds` viene de más
 * reciente a más antiguo y puede repetir ids (un producto se vende muchas veces); cada
 * producto sale una sola vez, en el lugar de su venta más reciente. Un producto vendido que
 * ya no está en el catálogo (sin existencia, inactivo) se omite: no se puede vender.
 */
export function recentlySold<T extends { id: string }>(
  catalog: T[],
  soldProductIds: string[],
  limit: number,
): T[] {
  const byId = new Map(catalog.map((p) => [p.id, p]))
  const result: T[] = []
  const seen = new Set<string>()
  for (const id of soldProductIds) {
    if (result.length >= limit) break
    const product = byId.get(id)
    if (!product || seen.has(id)) continue
    seen.add(id)
    result.push(product)
  }
  return result
}

/**
 * Valida el formulario de categoría. Regresa el mensaje (en español) o `null`.
 * Que el nombre no se repita lo decide la base (índice único); aquí solo la forma.
 */
export function validateCategory(input: { name: string; icon: string }): string | null {
  if (!input.name.trim()) return 'Escribe el nombre de la categoría.'
  if (input.name.trim().length > 40) return 'El nombre no puede pasar de 40 caracteres.'
  if (!isValidCategoryIcon(input.icon)) return 'Elige un ícono de la lista.'
  return null
}
