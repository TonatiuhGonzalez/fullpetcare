// Mezcla los cuatro tipos de evento del historial de una mascota (CLAUDE.md
// §1, punto 6 del alcance: "Historial completo de una mascota mezclando
// ambos tipos de visita") en una sola lista ordenada por fecha, de más
// reciente a más viejo.
//
// Función PURA (mismo criterio que lib/availability.ts, tarea 3.6): recibe
// los eventos YA leídos de la base (por services/petHistory.ts#getTimeline)
// y solo los ordena — no sabe nada de Supabase, tenant_id, ni de cómo se
// obtuvo cada dato. Eso es lo que la vuelve trivial de probar con datos de
// mentira (tarea 6.2), sin Docker ni Supabase local corriendo.
export type TimelineEntry =
  | {
      type: 'grooming'
      at: string
      appointmentId: string
      cutStyle: string | null
      groomerNotes: string | null
    }
  | {
      type: 'veterinary'
      at: string
      appointmentId: string
      reason: string | null
      diagnosis: string | null
    }
  | {
      type: 'vaccination'
      at: string
      vaccinationId: string
      vaccineName: string
    }
  | {
      type: 'weight'
      at: string
      weightId: string
      weightGrams: number
    }

/**
 * Ordena los eventos por `at`, del más reciente al más viejo (lo que
 * espera ver alguien abriendo el historial: lo último primero). Cuando dos
 * eventos comparten EXACTAMENTE el mismo instante, se conserva el orden en
 * que llegaron en `entries` — `Array.prototype.sort` es estable desde
 * ES2019, así que esto no es un accidente ni una casualidad del motor de
 * JS, es parte del contrato de la función.
 */
export function buildTimeline(entries: TimelineEntry[]): TimelineEntry[] {
  return [...entries].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
}
