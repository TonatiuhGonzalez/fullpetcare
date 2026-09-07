// Tests de lib/timeline.ts (tarea 6.2, parte pura — el aislamiento entre
// tenants y "mascota sin historial" se prueban contra Supabase real en
// supabase/tests/pet-history-service.spec.ts, porque una función pura no
// sabe qué es un tenant).
import { describe, expect, it } from 'vitest'

import { buildTimeline, type TimelineEntry } from './timeline'

describe('buildTimeline', () => {
  it('ordena eventos de distinto tipo por fecha, del más reciente al más viejo', () => {
    // El caso central de la tarea: una mascota real mezcla baños,
    // consultas, vacunas y pesadas en cualquier orden cronológico — si
    // esto ordenara mal, el historial contaría la vida de la mascota al
    // revés.
    const weight: TimelineEntry = {
      type: 'weight',
      at: '2026-01-01T10:00:00Z',
      weightId: 'w1',
      weightGrams: 12000,
    }
    const grooming: TimelineEntry = {
      type: 'grooming',
      at: '2026-03-01T10:00:00Z',
      appointmentId: 'a1',
      cutStyle: 'Verano',
      groomerNotes: null,
    }
    const vaccination: TimelineEntry = {
      type: 'vaccination',
      at: '2026-02-01T10:00:00Z',
      vaccinationId: 'v1',
      vaccineName: 'Rabia',
    }
    const veterinary: TimelineEntry = {
      type: 'veterinary',
      at: '2026-04-01T10:00:00Z',
      appointmentId: 'a2',
      reason: 'Revisión',
      diagnosis: null,
    }

    // A propósito NO se meten ya en orden — eso es justo lo que
    // buildTimeline debe corregir.
    expect(buildTimeline([weight, veterinary, vaccination, grooming])).toEqual([
      veterinary,
      grooming,
      vaccination,
      weight,
    ])
  })

  it('dos eventos en el MISMO instante conservan el orden en que llegaron', () => {
    // Caso real: se pesa a la mascota y se le aplica una vacuna en la
    // misma cita de veterinaria, ambas capturadas en el mismo segundo. No
    // hay una "fecha más exacta" que desempate — el contrato es que el
    // orden de entrada se respeta (sort estable), no que se invente un
    // criterio arbitrario.
    const vaccination: TimelineEntry = {
      type: 'vaccination',
      at: '2026-05-01T09:00:00Z',
      vaccinationId: 'v1',
      vaccineName: 'Bordetella',
    }
    const weight: TimelineEntry = {
      type: 'weight',
      at: '2026-05-01T09:00:00Z',
      weightId: 'w1',
      weightGrams: 8000,
    }

    expect(buildTimeline([vaccination, weight])).toEqual([vaccination, weight])
    // Y al revés: si llegan en el otro orden, el resultado también se voltea.
    expect(buildTimeline([weight, vaccination])).toEqual([weight, vaccination])
  })

  it('una mascota sin historial da una lista vacía, no un error', () => {
    expect(buildTimeline([])).toEqual([])
  })

  it('no muta el arreglo original', () => {
    // buildTimeline hace `[...entries].sort(...)`, no `entries.sort(...)`
    // — una función "pura" no debería tener el efecto secundario de
    // reordenar los datos que alguien más todavía está usando.
    const original: TimelineEntry[] = [
      { type: 'weight', at: '2026-01-01T00:00:00Z', weightId: 'w1', weightGrams: 1000 },
      { type: 'weight', at: '2026-02-01T00:00:00Z', weightId: 'w2', weightGrams: 1100 },
    ]
    const originalOrder = [...original]
    buildTimeline(original)
    expect(original).toEqual(originalOrder)
  })
})
