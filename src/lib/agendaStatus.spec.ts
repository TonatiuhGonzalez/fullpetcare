// Pruebas del estado que muestra la agenda. Lo que se rompería en producción: que dos
// estados se distingan solo por el color (cancelada y "no se presentó" comparten el
// rojo), o que una cita cobrada se siga viendo como "Completada" y recepción crea que
// falta cobrarla.
import { describe, expect, it } from 'vitest'

import { AGENDA_STATUSES, agendaStatusOf, type AgendaStatus } from './agendaStatus'

const ALL = Object.keys(AGENDA_STATUSES) as AgendaStatus[]

describe('AGENDA_STATUSES', () => {
  // Qué prueba: que cada estado trae nombre, ícono y color. Sin alguno, el bloque o la
  // leyenda pintarían un hueco.
  it.each(ALL)('"%s" tiene nombre, ícono y color', (status) => {
    const info = AGENDA_STATUSES[status]
    expect(info.status).toBe(status)
    expect(info.label).not.toBe('')
    expect(info.icon).toMatch(/^mdi-/)
    expect(info.color).not.toBe('')
  })

  // Qué prueba: la regla "el color nunca va solo" (CLAUDE.md §5.6). Si dos estados
  // comparten ícono, quien no distingue colores no los separa.
  it('no repite ícono entre estados', () => {
    const icons = ALL.map((status) => AGENDA_STATUSES[status].icon)
    expect(new Set(icons).size).toBe(icons.length)
  })

  // Qué prueba: que ningún estado usa el color de un tipo de visita. El naranja y el azul
  // son de estética y veterinaria (§5.6); si "En curso" los usara, se confundirían.
  it('no usa los colores de tipo de visita', () => {
    const colors = ALL.map((status) => AGENDA_STATUSES[status].color)
    expect(colors).not.toContain('grooming')
    expect(colors).not.toContain('veterinary')
    expect(colors).not.toContain('info')
  })
})

describe('agendaStatusOf', () => {
  // Qué prueba: el único caso en que el estado mostrado difiere del real.
  it('muestra "paid" solo si la cita está completada y cobrada', () => {
    expect(agendaStatusOf('completed', true)).toBe('paid')
    expect(agendaStatusOf('completed', false)).toBe('completed')
  })

  // Qué prueba: que "cobrada" no se cuele en otros estados. Una cita cancelada con una
  // venta cancelada no debe verse como cobrada.
  it('no cambia los demás estados aunque tengan una venta', () => {
    expect(agendaStatusOf('cancelled', true)).toBe('cancelled')
    expect(agendaStatusOf('in_progress', true)).toBe('in_progress')
    expect(agendaStatusOf('scheduled', true)).toBe('scheduled')
    expect(agendaStatusOf('no_show', true)).toBe('no_show')
  })
})
