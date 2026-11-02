// Tests de lib/hospitalization.ts (fase 33, tareas 33.3 y 33.7): días, costo y notas. Los casos
// de días repiten los de la base (hospitalization-rpc.spec.ts) para que las dos reglas no
// puedan diverger sin que un test falle.
import { describe, expect, it } from 'vitest'

import {
  formatTemperature,
  formatWeight,
  noteProblem,
  noteToStored,
  stayCharge,
  stayDays,
  suggestedRate,
  type NoteInput,
} from './hospitalization'

const MX = 'America/Mexico_City'
const TIJ = 'America/Tijuana'

describe('stayDays', () => {
  // Qué prueba: natural cuenta días calendario: 23:30 a 00:10 del día siguiente son 2; 24 h, 1.
  // Qué se rompería: el costo en pantalla no coincidiría con el que cobra la base.
  it('natural cuenta días calendario tocados; 24 horas, bloques', () => {
    const from = new Date('2026-10-15T05:30:00Z') // 23:30 del 14 en CDMX
    const to = new Date('2026-10-15T06:10:00Z') // 00:10 del 15
    expect(stayDays(from, to, 'natural', MX)).toBe(2)
    expect(stayDays(from, to, '24h', MX)).toBe(1)
  })

  // Qué prueba: la zona de la sucursal decide el día (§8.3).
  it('usa la zona de la sucursal', () => {
    const from = new Date('2026-10-15T06:30:00Z')
    const to = new Date('2026-10-15T08:00:00Z')
    expect(stayDays(from, to, 'natural', MX)).toBe(1)
    expect(stayDays(from, to, 'natural', TIJ)).toBe(2)
  })

  // Qué prueba: bordes de 24 h.
  it('24 horas: mínimo 1, 24 h exactas es 1 y un minuto más es 2', () => {
    const from = new Date('2026-10-15T10:00:00Z')
    expect(stayDays(from, from, '24h', MX)).toBe(1)
    expect(stayDays(from, new Date('2026-10-16T10:00:00Z'), '24h', MX)).toBe(1)
    expect(stayDays(from, new Date('2026-10-16T10:01:00Z'), '24h', MX)).toBe(2)
  })

  // Qué prueba: mismo día natural = 1 día.
  it('natural: ingreso y alta el mismo día es 1', () => {
    expect(
      stayDays(
        new Date('2026-10-15T14:00:00Z'),
        new Date('2026-10-15T20:00:00Z'),
        'natural',
        MX,
      ),
    ).toBe(1)
  })
})

describe('stayCharge', () => {
  const from = new Date('2026-10-13T16:00:00Z')
  const to = new Date('2026-10-15T16:00:00Z')

  // Qué prueba: por día multiplica la tarifa por los días; por estancia es el monto único.
  it('por día multiplica y por estancia es un monto único', () => {
    expect(
      stayCharge(
        { rateMode: 'per_day', rateCents: 50000, dayRule: 'natural' },
        from,
        to,
        MX,
      ),
    ).toEqual({
      days: 3,
      amountCents: 150000,
    })
    expect(
      stayCharge(
        { rateMode: 'per_stay', rateCents: 120000, dayRule: 'natural' },
        from,
        to,
        MX,
      ),
    ).toEqual({ days: 1, amountCents: 120000 })
  })
})

describe('suggestedRate', () => {
  const settings = { default_daily_rate_cents: 40000, default_stay_rate_cents: 100000 }

  // Qué prueba: la tarifa del espacio manda; sin ella, la del negocio; sin ninguna, nulo.
  it('usa la del espacio, luego la del negocio, luego nada', () => {
    const space = { daily_rate_cents: 60000, stay_rate_cents: null }
    expect(suggestedRate('per_day', space, settings)).toBe(60000)
    expect(suggestedRate('per_stay', space, settings)).toBe(100000)
    expect(
      suggestedRate('per_day', null, {
        default_daily_rate_cents: null,
        default_stay_rate_cents: null,
      }),
    ).toBeNull()
  })
})

describe('notas', () => {
  const empty: NoteInput = {
    content: '',
    temperatureC: null,
    weightKg: null,
    heartRateBpm: null,
    mucousColor: null,
    mood: null,
    elimination: null,
  }

  // Qué prueba: grados y kilos pasan a décimas de grado y gramos, sin flotantes en la base.
  it('guarda temperatura en décimas y peso en gramos', () => {
    const stored = noteToStored({ ...empty, temperatureC: 38.5, weightKg: 12.4 })
    expect(stored.temperature_deci_c).toBe(385)
    expect(stored.weight_grams).toBe(12400)
    // El caso de redondeo clásico: 0.1 + 0.2 no es 0.3 en flotante.
    expect(noteToStored({ ...empty, weightKg: 0.3 }).weight_grams).toBe(300)
  })

  // Qué prueba: una nota vacía no se guarda; con un solo dato (un estado de ánimo) sí.
  it('rechaza una nota vacía y acepta con un solo dato', () => {
    expect(noteProblem(empty)).not.toBeNull()
    expect(noteProblem({ ...empty, mood: 'calm' })).toBeNull()
    expect(noteProblem({ ...empty, content: '  ' })).not.toBeNull()
  })

  // Qué prueba: los rangos que también exige la base (temperatura, pulso).
  it('valida los rangos de temperatura y frecuencia cardiaca', () => {
    expect(noteProblem({ ...empty, temperatureC: 60 })).not.toBeNull()
    expect(noteProblem({ ...empty, temperatureC: 38.5 })).toBeNull()
    expect(noteProblem({ ...empty, heartRateBpm: 5 })).not.toBeNull()
    expect(noteProblem({ ...empty, heartRateBpm: 110 })).toBeNull()
  })

  it('da formato a temperatura y peso', () => {
    expect(formatTemperature(385)).toBe('38.5 °C')
    expect(formatWeight(12400)).toBe('12.4 kg')
    expect(formatTemperature(null)).toBeNull()
  })
})
