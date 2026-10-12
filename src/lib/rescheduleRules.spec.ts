// Reglas de reprogramar (C1.13). Funciones puras: "ahora" y el horario de la sucursal
// entran como datos, sin reloj ni Supabase.
import { describe, expect, it } from 'vitest'

import { overlapCandidates, rescheduleProblem } from './rescheduleRules'

const hours = { opensAt: '09:00', closesAt: '18:00' }
const now = { date: '2026-10-12', time: '12:00' }
const base = {
  date: '2026-10-13',
  time: '10:00',
  durationMinutes: 60,
  branchHours: hours,
  now,
}

describe('rescheduleProblem', () => {
  it('un horario futuro dentro del horario es valido', () => {
    // El camino feliz: si esto devolviera un mensaje, nadie podria reprogramar.
    expect(rescheduleProblem(base)).toBeNull()
  })

  it('faltan fecha u hora', () => {
    // Un input vacio daria una fecha invalida al construir el instante; debe frenarse antes.
    expect(rescheduleProblem({ ...base, date: '' })).toMatch(/fecha y la hora/)
    expect(rescheduleProblem({ ...base, time: '' })).toMatch(/fecha y la hora/)
  })

  it('un dia anterior a hoy ya paso', () => {
    // Reprogramar al pasado dejaria una cita "agendada" que nadie atendera.
    expect(rescheduleProblem({ ...base, date: '2026-10-11' })).toMatch(/ya pas/)
  })

  it('hoy a una hora anterior a ahora ya paso, y justo ahora todavia vale', () => {
    // Sin tolerancia: 11:59 ya paso, 12:00 (el minuto actual) no. Igual que agendar.
    expect(rescheduleProblem({ ...base, date: now.date, time: '11:59' })).toMatch(
      /ya pas/,
    )
    expect(rescheduleProblem({ ...base, date: now.date, time: '12:00' })).toBeNull()
  })

  it('un dia cerrado se rechaza con su mensaje', () => {
    // branchHours nulo = la sucursal no abre; sin esto el error llegaria hasta la base.
    expect(rescheduleProblem({ ...base, branchHours: null })).toMatch(/no abre/)
  })

  it('la cita completa debe caber en el horario, no solo su inicio', () => {
    // 17:30 esta dentro, pero con 60 min termina 18:30, despues del cierre.
    expect(rescheduleProblem({ ...base, time: '17:30' })).toMatch(/fuera del horario/)
    expect(rescheduleProblem({ ...base, time: '17:00' })).toBeNull()
    expect(rescheduleProblem({ ...base, time: '08:30' })).toMatch(/fuera del horario/)
  })
})

describe('overlapCandidates', () => {
  const tz = 'America/Mexico_City'
  const at = (id: string, status: string, from: string, to: string) => ({
    id,
    employee_user_id: 'emp-1',
    status,
    starts_at: from,
    ends_at: to,
  })

  it('excluye la propia cita, las canceladas y las no asistidas', () => {
    // Si la propia cita entrara, siempre avisaria que choca consigo misma; si entraran las
    // canceladas, avisaria de huecos que en realidad estan libres.
    const list = [
      at('self', 'scheduled', '2026-10-13T16:00:00Z', '2026-10-13T17:00:00Z'),
      at('c', 'cancelled', '2026-10-13T16:00:00Z', '2026-10-13T17:00:00Z'),
      at('n', 'no_show', '2026-10-13T16:00:00Z', '2026-10-13T17:00:00Z'),
      at('ok', 'scheduled', '2026-10-13T18:00:00Z', '2026-10-13T19:00:00Z'),
    ]
    expect(overlapCandidates(list, 'self', tz)).toEqual([
      { employeeId: 'emp-1', startsAt: '12:00', endsAt: '13:00' },
    ])
  })

  it('pasa los instantes a la hora local de la sucursal, no a UTC', () => {
    // 16:00Z es 10:00 en CDMX (UTC-6) y 09:00 en Tijuana (UTC-7, horario de verano).
    // Si se comparara en UTC, el aviso saldria a la hora equivocada.
    const list = [at('x', 'scheduled', '2026-10-13T16:00:00Z', '2026-10-13T17:00:00Z')]
    expect(overlapCandidates(list, 'self', tz)[0].startsAt).toBe('10:00')
    expect(overlapCandidates(list, 'self', 'America/Tijuana')[0].startsAt).toBe('09:00')
  })
})
