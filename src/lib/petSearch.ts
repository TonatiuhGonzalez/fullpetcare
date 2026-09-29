// Búsqueda de mascotas para la pestaña "Mascotas" de Clientes. Función
// pura: entra texto, sale sí/no — sin red ni Supabase (CLAUDE.md §4).
import { speciesLabel } from '@/lib/petLabels'
import type { Database } from '@/types/database'

type PetSpecies = Database['public']['Enums']['pet_species']

/** Minúsculas y sin acentos, para que "Perro", "perro" y "PÉRRO" coincidan. */
function normalize(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
}

/**
 * ¿La mascota coincide con lo que se escribió en el buscador? Compara
 * contra el nombre, la especie (en español, como la ve el usuario) y el
 * nombre completo del dueño. Término vacío = coincide todo.
 */
export function matchesPetSearch(
  pet: { name: string; species: PetSpecies },
  ownerName: string,
  term: string,
): boolean {
  const needle = normalize(term)
  if (needle === '') return true

  return [pet.name, speciesLabel(pet.species), ownerName].some((field) =>
    normalize(field).includes(needle),
  )
}
