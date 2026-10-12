// Armado de datos de las pantallas de Clientes (Correcciones 1, C1.15 y C1.16).
// Funciones puras: la tabla trae TODAS las mascotas en una sola consulta y aquí se
// reparten por cliente; la página de cliente decide qué mascota queda elegida.

/** Máximo de chips de mascota que caben en una fila de la tabla antes de poner "+K más". */
export const MAX_PET_CHIPS = 3

/**
 * Reparte las mascotas por cliente. Conserva el orden en que llegan (la consulta ya las
 * ordena por nombre). Un cliente sin mascotas simplemente no aparece en el mapa.
 */
export function groupPetsByCustomer<T extends { customer_id: string }>(
  pets: T[],
): Map<string, T[]> {
  const byCustomer = new Map<string, T[]>()
  for (const pet of pets) {
    const list = byCustomer.get(pet.customer_id)
    if (list) list.push(pet)
    else byCustomer.set(pet.customer_id, [pet])
  }
  return byCustomer
}

/**
 * Parte la lista de mascotas de una fila en las que se muestran y cuántas quedan
 * ocultas ("+K más"), para que un cliente con muchas mascotas no desborde la fila.
 */
export function splitVisiblePets<T>(
  pets: T[],
  max: number = MAX_PET_CHIPS,
): { visible: T[]; hiddenCount: number } {
  const limit = Math.max(0, max)
  return { visible: pets.slice(0, limit), hiddenCount: Math.max(0, pets.length - limit) }
}

/** Ícono de la especie: perro y gato tienen el suyo; "otro" usa una huella. */
export function speciesIcon(species: 'dog' | 'cat' | 'other'): string {
  if (species === 'dog') return 'mdi-dog'
  if (species === 'cat') return 'mdi-cat'
  return 'mdi-paw'
}

/**
 * Mascota que queda elegida en la página de cliente: se conserva la que ya estaba si
 * sigue en la lista (por ejemplo, tras editar); si no (primera carga o se eliminó),
 * la primera; sin mascotas, null.
 */
export function pickSelectedPetId(
  pets: Array<{ id: string }>,
  currentId: string | null,
): string | null {
  if (currentId && pets.some((pet) => pet.id === currentId)) return currentId
  return pets[0]?.id ?? null
}
