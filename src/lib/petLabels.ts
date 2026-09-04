// Nombres en español para los enums de pets, igual que lib/roles.ts.
// Los tipos son import type (se borran al compilar), así que esto sigue
// siendo una función pura sin dependencia real de services/ en tiempo de
// ejecución (CLAUDE.md §4).
import type { Database } from '@/types/database'

type PetSpecies = Database['public']['Enums']['pet_species']
type PetSex = Database['public']['Enums']['pet_sex']

const SPECIES_LABELS: Record<PetSpecies, string> = {
  dog: 'Perro',
  cat: 'Gato',
  other: 'Otro',
}

const SEX_LABELS: Record<PetSex, string> = {
  male: 'Macho',
  female: 'Hembra',
}

export function speciesLabel(species: PetSpecies): string {
  return SPECIES_LABELS[species]
}

/** null cuando no se especificó al dar de alta (CLAUDE.md: no es un tercer valor del enum). */
export function sexLabel(sex: PetSex | null): string {
  if (!sex) return 'No especificado'
  return SEX_LABELS[sex]
}
