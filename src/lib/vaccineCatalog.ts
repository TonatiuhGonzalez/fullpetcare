// Reglas del catálogo de vacunas (fase 26, PLAN.md D29). Funciones puras: el formulario
// las usa para avisar antes de guardar; la base solo exige `name` no nulo.
import { normalizeSearchText } from './searchText'

/** Tope de días de refuerzo: 10 años. Más que eso casi seguro es un error de captura. */
export const MAX_INTERVAL_DAYS = 3650

export type VaccineSpecies = 'dog' | 'cat' | 'other' | null

/** Nombre en español de la especie de una vacuna; nulo = aplica a cualquiera. */
export function vaccineSpeciesLabel(species: VaccineSpecies): string {
  if (species === 'dog') return 'Perro'
  if (species === 'cat') return 'Gato'
  if (species === 'other') return 'Otra'
  return 'Todas las especies'
}

/**
 * Texto del intervalo para mostrar en la lista. Nulo = "sin refuerzo": la vacuna se aplica
 * una sola vez y la cartilla no calcula próxima dosis (vaccines.default_interval_days es
 * nullable por esto, lib/vaccination.ts).
 */
export function intervalLabel(days: number | null): string {
  if (days == null) return 'Sin refuerzo'
  return days === 1 ? 'Cada día' : `Cada ${days} días`
}

/** Mensaje si los días de refuerzo no sirven (vacío es válido: sin refuerzo); si no, `null`. */
export function intervalProblem(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null
  const days = Number(value)
  if (!Number.isInteger(days) || days < 1) return 'Escribe un número entero de días, mayor a 0.'
  if (days > MAX_INTERVAL_DAYS) return `El refuerzo no puede pasar de ${MAX_INTERVAL_DAYS} días.`
  return null
}

/**
 * ¿Ya hay una vacuna con este nombre y esta especie? Se compara sin acentos ni mayúsculas
 * (la ñ aparte). Dos vacunas con el mismo nombre pero distinta especie sí pueden convivir
 * ("Polivalente" de perro y de gato). `exceptId` evita que una vacuna choque consigo misma
 * al editarla.
 */
export function isDuplicateVaccine(
  existing: Array<{ id: string; name: string; species: VaccineSpecies }>,
  candidate: { name: string; species: VaccineSpecies },
  exceptId?: string,
): boolean {
  const name = normalizeSearchText(candidate.name)
  return existing.some(
    (v) =>
      v.id !== exceptId &&
      v.species === candidate.species &&
      normalizeSearchText(v.name) === name,
  )
}
