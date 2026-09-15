// Cada caso aquí es un escenario real de la agenda (mismo criterio
// didáctico que availability.spec.ts): datos puros adentro, resultado
// puro afuera, sin Supabase ni fecha del sistema.
import { describe, expect, it } from 'vitest'

import { consecutiveDates, visibleHourRange } from './calendarGrid'

describe('consecutiveDates', () => {
  it('da N días seguidos empezando EXACTAMENTE en la fecha dada, sin alinear a lunes', () => {
    // El caso que justifica esta función (rediseño de la agenda): la
    // vista de groomer/vet es "hoy y los próximos 6 días", no "la semana
    // calendario que contiene hoy" — si esto alineara a lunes (como el
    // weekDates() de la versión anterior), un groomer que entra un
    // jueves vería su agenda empezar en el lunes YA PASADO en vez de hoy.
    expect(consecutiveDates('2027-06-15', 7)).toEqual([
      '2027-06-15',
      '2027-06-16',
      '2027-06-17',
      '2027-06-18',
      '2027-06-19',
      '2027-06-20',
      '2027-06-21',
    ])
  })

  it('cruza de mes correctamente', () => {
    // 2027-02-26 + 6 días se sale de febrero (28 días en 2027, no
    // bisiesto) — si la suma de días fuera aritmética de texto en vez de
    // dejar que date-fns normalice el desbordamiento, este caso es donde
    // se rompería.
    expect(consecutiveDates('2027-02-26', 7)).toEqual([
      '2027-02-26',
      '2027-02-27',
      '2027-02-28',
      '2027-03-01',
      '2027-03-02',
      '2027-03-03',
      '2027-03-04',
    ])
  })

  it('count=1 da solo la fecha de inicio — el caso de la vista de dueño/recepción (un solo día)', () => {
    expect(consecutiveDates('2027-06-15', 1)).toEqual(['2027-06-15'])
  })
})

describe('visibleHourRange', () => {
  it('con un solo día (vista de dueño/recepción), el rango es exactamente el horario de ESE día', () => {
    const range = visibleHourRange([{ opensAt: '09:00', closesAt: '18:00' }])
    expect(range).toEqual({ startMinutes: 9 * 60, endMinutes: 18 * 60 })
  })

  it('con varios días (vista de groomer/vet), usa la UNIÓN: el sábado que cierra más temprano no recorta la grilla', () => {
    // Caso real de la semilla (seed.sql): lunes a viernes 09:00-18:00,
    // sábado 09:00-15:00, domingo cerrado. La grilla de los 7 días debe
    // llegar hasta las 18:00 (la hora de cierre más tardía), no
    // quedarse en 15:00 solo porque ese día cierra antes.
    const range = visibleHourRange([
      { opensAt: '09:00', closesAt: '18:00' },
      { opensAt: '09:00', closesAt: '18:00' },
      { opensAt: '09:00', closesAt: '18:00' },
      { opensAt: '09:00', closesAt: '18:00' },
      { opensAt: '09:00', closesAt: '18:00' },
      { opensAt: '09:00', closesAt: '15:00' },
      null,
    ])
    expect(range).toEqual({ startMinutes: 9 * 60, endMinutes: 18 * 60 })
  })

  it('si ningún día visible abre, cae en el rango por default en vez de quedar vacío', () => {
    expect(visibleHourRange([null])).toEqual({ startMinutes: 9 * 60, endMinutes: 18 * 60 })
    expect(visibleHourRange([null, null, null, null, null, null, null])).toEqual({
      startMinutes: 9 * 60,
      endMinutes: 18 * 60,
    })
  })
})
