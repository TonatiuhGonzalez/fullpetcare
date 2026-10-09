// Ayudantes compartidos por EmployeeDayScheduler.vue y EmployeeWeekCalendar.vue: cómo se
// convierte un bloque de la agenda en un evento de EventCalendar (@event-calendar/core) y
// cómo se pinta por dentro. Se separan para que las dos vistas se vean igual (PLAN.md D20).
//
// Cada bloque conserva su color de ESTADO como fondo; el TIPO de visita va aparte, como
// una franja de color a la izquierda (clase `ec-kind-*`, ver styles/main.scss) y un ícono
// antes del título. Así el color nunca es la única señal del tipo.
import type { CalendarBlock } from '@/lib/calendarGrid'
import { VISIT_KINDS, type VisitKind } from '@/lib/visitKind'

export function toCalendarEvents(blocks: CalendarBlock[]) {
  return blocks.map((block) => ({
    id: block.id,
    start: block.start,
    end: block.end,
    title: block.text,
    resourceIds: block.resource ? [block.resource] : [],
    backgroundColor: block.color,
    textColor: block.textColor,
    classNames: [`ec-kind-${block.kind}`],
    extendedProps: { kind: block.kind },
  }))
}

// Contenido del bloque: hora, ícono del tipo y título. Se arma con nodos del DOM y no con
// HTML porque el título lleva nombres de clientes y mascotas escritos por personas: como
// texto nunca se interpreta como HTML.
// Lo que EventCalendar entrega al pintar un evento (la librería no exporta ese tipo).
interface EventContentArg {
  event: { title: unknown; extendedProps: Record<string, unknown> }
  timeText: string
}

export function renderEventContent(info: EventContentArg): { domNodes: Node[] } {
  const nodes: Node[] = []

  if (info.timeText) {
    const time = document.createElement('div')
    time.className = 'ec-event-time'
    time.textContent = info.timeText
    nodes.push(time)
  }

  const title = document.createElement('div')
  title.className = 'ec-event-title'
  const kind = info.event.extendedProps.kind as VisitKind | undefined
  if (kind && VISIT_KINDS[kind]) {
    const icon = document.createElement('i')
    icon.className = `mdi ${VISIT_KINDS[kind].icon} ec-event-kind-icon`
    icon.setAttribute('aria-hidden', 'true')
    title.appendChild(icon)
  }
  title.appendChild(document.createTextNode(String(info.event.title)))
  nodes.push(title)

  return { domNodes: nodes }
}
