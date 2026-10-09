// Pruebas de los ayudantes del calendario de la agenda. Lo que se rompería en
// producción: que el nombre de un cliente con caracteres de HTML se pinte como HTML
// (inyección en la agenda de todo el equipo), o que se pierda la franja y el ícono del
// tipo de visita y el calendario vuelva a depender solo del color.
import { describe, expect, it } from 'vitest'

import type { CalendarBlock } from '@/lib/calendarGrid'
import { renderEventContent, toCalendarEvents } from './calendarEvents'

const block: CalendarBlock = {
  id: 'a1',
  start: '2026-10-08T15:00:00',
  end: '2026-10-08T15:30:00',
  text: 'Sofía · Rocky — Estética',
  color: 'rgb(var(--v-theme-success))',
  textColor: 'rgb(var(--v-theme-on-success))',
  kind: 'grooming',
  resource: 'emp-1',
}

describe('toCalendarEvents', () => {
  // Qué prueba: que el evento lleva el color de ESTADO como fondo, su color de texto
  // propio (no blanco fijo: en modo oscuro el fondo es claro) y la clase de franja del
  // tipo. Sin la clase, el bloque pierde la franja naranja/azul.
  it('conserva el color de estado y marca el tipo con una clase', () => {
    const [event] = toCalendarEvents([block])
    expect(event.backgroundColor).toBe('rgb(var(--v-theme-success))')
    expect(event.textColor).toBe('rgb(var(--v-theme-on-success))')
    expect(event.classNames).toEqual(['ec-kind-grooming'])
    expect(event.extendedProps).toEqual({ kind: 'grooming' })
  })

  // Qué prueba: la fila por empleado (vista de dueño/recepción). Sin `resource` el
  // bloque queda sin fila; con ella, en su empleado.
  it('asigna la fila del empleado solo si el bloque la trae', () => {
    expect(toCalendarEvents([block])[0].resourceIds).toEqual(['emp-1'])
    expect(toCalendarEvents([{ ...block, resource: undefined }])[0].resourceIds).toEqual(
      [],
    )
  })
})

describe('renderEventContent', () => {
  const info = (title: string, kind?: string, timeText = '15:00') => ({
    event: { title, extendedProps: kind ? { kind } : {} },
    timeText,
  })

  // Qué prueba: el caso de seguridad. Un nombre con HTML debe quedar como TEXTO. Si se
  // armara con innerHTML, ese `<img onerror>` se ejecutaría en la agenda de todos.
  it('trata el título como texto y nunca como HTML', () => {
    const { domNodes } = renderEventContent(
      info('<img src=x onerror=alert(1)> Rocky', 'grooming'),
    )
    const host = document.createElement('div')
    domNodes.forEach((node) => host.appendChild(node))
    expect(host.querySelector('img')).toBeNull()
    expect(host.textContent).toContain('<img src=x onerror=alert(1)> Rocky')
  })

  // Qué prueba: que cada tipo lleva su ícono propio (tijeras / estetoscopio). Es la
  // señal que no depende del color para quien no distingue naranja de azul.
  it('pone el ícono del tipo de visita antes del título', () => {
    const grooming = renderEventContent(info('x', 'grooming')).domNodes
    const vet = renderEventContent(info('x', 'veterinary')).domNodes
    const iconOf = (nodes: Node[]) =>
      (nodes.at(-1) as HTMLElement).querySelector('i')?.className
    expect(iconOf(grooming)).toContain('mdi-content-cut')
    expect(iconOf(vet)).toContain('mdi-stethoscope')
  })

  // Qué prueba: bordes. Sin tipo conocido no se pinta ícono (ni truena), y sin hora no
  // se crea el bloque de hora vacío.
  it('tolera un tipo desconocido y la falta de hora', () => {
    const { domNodes } = renderEventContent(info('Cita', 'otro', ''))
    expect(domNodes).toHaveLength(1)
    expect((domNodes[0] as HTMLElement).querySelector('i')).toBeNull()
  })
})
