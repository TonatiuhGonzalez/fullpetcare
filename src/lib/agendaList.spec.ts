// Tests de lib/agendaList.ts (fase 26, tarea 26.15): la lista de la agenda para celular.
import { describe, expect, it } from 'vitest'

import type { CalendarBlock } from './calendarGrid'
import { groupBlocksByDay, timeRange } from './agendaList'

function block(id: string, start: string, end: string): CalendarBlock {
  return {
    id,
    start,
    end,
    text: id,
    customer: 'Cliente',
    pet: 'Mascota',
    status: 'scheduled',
    kind: 'grooming',
    origin: null,
  }
}

describe('groupBlocksByDay', () => {
  // Qué prueba: que las citas salen en orden de hora aunque lleguen desordenadas.
  // Qué se rompería: en el celular la recepción vería la cita de las 16:00 antes que la de
  // las 9:00 y perdería el hilo del día.
  it('ordena por hora de inicio dentro de cada día', () => {
    const groups = groupBlocksByDay([
      block('c', '2026-10-13T16:00:00', '2026-10-13T17:00:00'),
      block('a', '2026-10-13T09:00:00', '2026-10-13T10:00:00'),
      block('b', '2026-10-13T11:30:00', '2026-10-13T12:00:00'),
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0].blocks.map((b) => b.id)).toEqual(['a', 'b', 'c'])
  })

  // Qué prueba: que la semana de groomer/vet se separa por día y los días van en orden.
  // Qué se rompería: las citas de varios días saldrían mezcladas en una sola lista.
  it('agrupa por día y ordena los días', () => {
    const groups = groupBlocksByDay([
      block('mar', '2026-10-14T09:00:00', '2026-10-14T10:00:00'),
      block('lun', '2026-10-13T09:00:00', '2026-10-13T10:00:00'),
    ])
    expect(groups.map((g) => g.date)).toEqual(['2026-10-13', '2026-10-14'])
  })

  // Qué prueba: a igual hora, el orden es estable (por id) y no depende de cómo llegaron.
  // Qué se rompería: dos citas a la misma hora cambiarían de lugar tras cada recarga.
  it('desempata por id para que el orden no cambie entre recargas', () => {
    const one = groupBlocksByDay([
      block('b', '2026-10-13T09:00:00', '2026-10-13T10:00:00'),
      block('a', '2026-10-13T09:00:00', '2026-10-13T10:00:00'),
    ])
    expect(one[0].blocks.map((b) => b.id)).toEqual(['a', 'b'])
  })

  // Qué prueba: sin citas no hay grupos (la pantalla muestra su estado vacío).
  it('devuelve vacío sin citas', () => {
    expect(groupBlocksByDay([])).toEqual([])
  })
})

describe('timeRange', () => {
  // Qué prueba: que se toma la hora de pared tal cual, sin pasarla por zonas horarias.
  // Qué se rompería: un `new Date()` movería la hora según el navegador (§8.3).
  it('muestra la hora de pared de la sucursal', () => {
    expect(timeRange({ start: '2026-10-13T09:00:00', end: '2026-10-13T10:30:00' })).toBe(
      '09:00 – 10:30',
    )
  })
})
