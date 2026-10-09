// Identidad de cada tipo de visita (PLAN.md D20): cómo se llama, qué ícono lleva y
// qué color del tema usa. Es la ÚNICA fuente: agenda, chips, historial y reportes
// la consultan, en vez de repetir "Estética"/"Veterinaria" en cada archivo.
//
// Regla de accesibilidad: el color nunca va solo. Cada tipo tiene además un ícono y
// un nombre, para que se distingan también con daltonismo, en escala de grises o
// con poca luz. Quien pinte un tipo de visita debe mostrar al menos el ícono o el texto.

export type VisitKind = 'grooming' | 'veterinary'

export interface VisitKindInfo {
  kind: VisitKind
  // Texto para la persona usuaria, en español de México.
  label: string
  // Ícono de Material Design Icons (`mdi-…`).
  icon: string
  // Nombre del color en el tema de Vuetify (plugins/vuetify.ts); sirve en
  // `color="…"`, `bg-…` o `text-…`. Coincide con las claves de lib/palette.ts.
  color: string
}

export const VISIT_KINDS: Record<VisitKind, VisitKindInfo> = {
  grooming: {
    kind: 'grooming',
    label: 'Estética',
    icon: 'mdi-content-cut',
    color: 'grooming',
  },
  veterinary: {
    kind: 'veterinary',
    label: 'Veterinaria',
    icon: 'mdi-stethoscope',
    color: 'veterinary',
  },
}

export function visitKindInfo(kind: VisitKind): VisitKindInfo {
  return VISIT_KINDS[kind]
}
