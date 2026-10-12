// Pruebas de los ayudantes del calendario de la agenda. Lo que se rompería en
// producción: que el nombre de un cliente con caracteres de HTML se pinte como HTML
// (inyección en la agenda de todo el equipo), o que se pierda la franja y el ícono del
// tipo de visita y el calendario vuelva a depender solo del color.
import { describe, expect, it } from 'vitest'

import type { CalendarBlock } from '@/lib/calendarGrid'
import {
  initialsOf,
  renderEventContent,
  renderResourceLabel,
  toCalendarEvents,
} from './calendarEvents'

const block: CalendarBlock = {
  id: 'a1',
  start: '2026-10-08T15:00:00',
  end: '2026-10-08T15:30:00',
  text: 'Sofía · Rocky — Estética',
  customer: 'Sofía',
  pet: 'Rocky',
  status: 'completed',
  kind: 'grooming',
  origin: null,
  resource: 'emp-1',
}

describe('toCalendarEvents', () => {
  // Qué prueba: que el evento lleva su estado y su tipo como CLASES (el color sale de
  // styles/main.scss, con tokens del tema) y que ya no trae colores fijos. Si volviera a
  // llevar `backgroundColor`, el estilo en línea taparía el bloque tonal y el modo oscuro.
  it('marca estado y tipo con clases y no trae colores fijos', () => {
    const [event] = toCalendarEvents([block])
    expect(event.classNames).toEqual(['ec-kind-grooming', 'ec-status-completed'])
    expect(event).not.toHaveProperty('backgroundColor')
    expect(event).not.toHaveProperty('textColor')
    expect(event.extendedProps).toMatchObject({ kind: 'grooming', status: 'completed' })
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
  const info = (extra: Record<string, unknown>, timeText = '15:00', title = 'Cita') => ({
    event: { title, extendedProps: extra },
    timeText,
  })
  const render = (extra: Record<string, unknown>, timeText?: string, title?: string) => {
    const host = document.createElement('div')
    renderEventContent(info(extra, timeText, title)).domNodes.forEach((n) =>
      host.appendChild(n),
    )
    return host
  }

  // Qué prueba: el caso de seguridad. Un nombre con HTML debe quedar como TEXTO. Si se
  // armara con innerHTML, ese `<img onerror>` se ejecutaría en la agenda de todos.
  it('trata mascota y cliente como texto y nunca como HTML', () => {
    const host = render({
      kind: 'grooming',
      status: 'scheduled',
      pet: '<img src=x onerror=alert(1)> Rocky',
      customer: '<b>Sofía</b>',
    })
    expect(host.querySelector('img')).toBeNull()
    expect(host.querySelector('.ec-event-title b')).toBeNull()
    expect(host.textContent).toContain('<img src=x onerror=alert(1)> Rocky')
  })

  // Qué prueba: que la mascota va en negritas y el cliente después, sin repetir el tipo ni
  // el empleado (ya están en la franja, el ícono y la fila).
  it('muestra la mascota en negritas y luego el cliente', () => {
    const host = render({
      kind: 'grooming',
      status: 'scheduled',
      pet: 'Rocky',
      customer: 'Sofía',
    })
    expect(host.querySelector('.ec-event-title strong')?.textContent).toBe('Rocky')
    expect(host.querySelector('.ec-event-title')?.textContent).toBe('Rocky · Sofía')
  })

  // Qué prueba: que el título no lleva ningún ícono (ni de tipo, ni de estado, ni de origen):
  // el bloque de una hora mide ~95 px y los íconos le quitaban el lugar al nombre de la
  // mascota. Lo que distingue al bloque es su color; el detalle va en el tooltip.
  it('no pinta íconos en el título, ni de tipo, ni de estado, ni de origen', () => {
    const host = render({
      kind: 'veterinary',
      status: 'paid',
      origin: 'urgent',
      pet: 'Rocky',
      customer: 'Sofía',
    })
    expect(host.querySelector('i')).toBeNull()
    expect(host.querySelector('.ec-event-title')?.textContent).toBe('Rocky · Sofía')
  })

  // Qué prueba: bordes. Sin datos del bloque se usa el título, sin tipo no se pinta
  // ícono (ni truena) y sin hora ni estado no se crea el bloque de hora vacío.
  it('tolera un bloque sin datos, un tipo desconocido y la falta de hora', () => {
    const host = render({ kind: 'otro' }, '', 'Cita suelta')
    expect(host.querySelector('.ec-event-time')).toBeNull()
    expect(host.querySelector('i')).toBeNull()
    expect(host.textContent).toBe('Cita suelta')
  })
})

describe('encabezado de empleado', () => {
  // Qué prueba: las iniciales del avatar con nombres reales: dos palabras, una, con
  // espacios de sobra y vacío. Sin esto un nombre vacío tronaría al leer `word[0]`.
  it('saca las iniciales de las dos primeras palabras', () => {
    expect(initialsOf('Ana Robles Pérez')).toBe('AR')
    expect(initialsOf('  luis ')).toBe('L')
    expect(initialsOf('')).toBe('')
  })

  // Qué prueba: el contador en singular, plural y cero, y que el nombre es texto. Una
  // recepcionista lo lee para repartir citas: "1 citas" o "0 citas" se ve descuidado.
  it('cuenta las citas del día y trata el nombre como texto', () => {
    const label = (name: string, count: number) => {
      const host = document.createElement('div')
      renderResourceLabel(name, count).domNodes.forEach((n) => host.appendChild(n))
      return host
    }
    expect(label('Ana', 0).querySelector('.ec-resource-count')?.textContent).toBe(
      'Sin citas',
    )
    expect(label('Ana', 1).querySelector('.ec-resource-count')?.textContent).toBe(
      '1 cita',
    )
    expect(label('Ana', 3).querySelector('.ec-resource-count')?.textContent).toBe(
      '3 citas',
    )
    const host = label('<img src=x onerror=alert(1)>', 2)
    expect(host.querySelector('img')).toBeNull()
  })
})
