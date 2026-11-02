// Reglas del catálogo de especies y razas (fase 27, PLAN.md D30 punto 1). Funciones puras:
// la pantalla de Configuración y el formulario de mascota las usan; la base solo exige
// nombres no vacíos y sin repetir.
import { normalizeSearchText } from './searchText'

export interface BreedLike {
  id: string
  name: string
  search_aliases: string[]
}

/**
 * ¿Ya existe un elemento con este nombre en la lista? Sin acentos, mayúsculas ni espacios
 * (la ñ aparte). `exceptId` evita que un elemento choque consigo mismo al editarlo.
 */
export function isDuplicateName(
  existing: Array<{ id: string; name: string }>,
  name: string,
  exceptId?: string,
): boolean {
  const wanted = normalizeSearchText(name)
  return existing.some(
    (item) => item.id !== exceptId && normalizeSearchText(item.name) === wanted,
  )
}

/**
 * Razas que coinciden con lo que la persona escribió, para el selector con búsqueda. Mira
 * el nombre y las variantes ("xolo", "teckel"). Primero las que EMPIEZAN con el texto y
 * luego las que lo contienen; sin texto devuelve todas, en el orden recibido.
 */
export function filterBreeds<T extends BreedLike>(breeds: T[], query: string): T[] {
  const q = normalizeSearchText(query)
  if (q === '') return breeds

  const starts: T[] = []
  const contains: T[] = []
  for (const breed of breeds) {
    const candidates = [breed.name, ...breed.search_aliases].map(normalizeSearchText)
    if (candidates.some((c) => c.startsWith(q))) starts.push(breed)
    else if (candidates.some((c) => c.includes(q))) contains.push(breed)
  }
  return [...starts, ...contains]
}

/** "xolo, teckel" → ['xolo', 'teckel']: sin vacíos ni repetidos (sin acentos ni mayúsculas). */
export function parseAliases(text: string): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const piece of text.split(',')) {
    const alias = piece.trim()
    const key = normalizeSearchText(alias)
    if (key === '' || seen.has(key)) continue
    seen.add(key)
    result.push(alias)
  }
  return result
}

/** Las variantes de una raza escritas separadas por coma, para el campo del formulario. */
export function aliasesToText(aliases: string[]): string {
  return aliases.join(', ')
}
