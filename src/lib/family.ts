// Reglas de las familias de clientes (fase 31, PLAN.md D30 punto 7). Funciones puras.

/**
 * Cómo se llama una familia en pantalla: su nombre y, después, las mascotas de sus miembros.
 * "Familia Pérez – Nube, Toby". Sin mascotas, solo el nombre.
 */
export function familyLabel(name: string, petNames: string[]): string {
  const unique = [...new Set(petNames.map((n) => n.trim()).filter((n) => n !== ''))]
  const base = name.trim()
  return unique.length > 0 ? `${base} – ${unique.join(', ')}` : base
}

export interface FamilyInput {
  name: string
  memberIds: string[]
  holderId: string | null
}

/**
 * Mensaje si la familia no se puede guardar (en español, para mostrarlo tal cual); si no,
 * `null`. Son las mismas reglas que impone `save_family()`.
 */
export function familyProblem(input: FamilyInput): string | null {
  if (input.name.trim() === '') return 'Escribe el nombre de la familia.'
  if (input.memberIds.length === 0) return 'La familia necesita al menos un miembro.'
  if (input.holderId === null || !input.memberIds.includes(input.holderId)) {
    return 'Elige al titular entre los miembros.'
  }
  return null
}

/** Mensaje en español para un error de la base al guardar o transferir. */
export function familyErrorMessage(error: unknown, fallback: string): string {
  if (error && typeof error === 'object' && 'message' in error) {
    const { message, code } = error as { message: string; code?: string }
    // 23514 check_violation, 42501 insufficient_privilege, P0002 no_data_found: la función ya
    // manda su texto en español; los demás errores (red, PostgREST) no se muestran tal cual.
    if (code === '23514' || code === '42501' || code === 'P0002') return message
  }
  return fallback
}
