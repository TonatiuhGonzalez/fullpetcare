// Ayudantes compartidos por EmployeeDayScheduler.vue y EmployeeWeekCalendar.vue: cómo se
// convierte un bloque de la agenda en un evento de EventCalendar (@event-calendar/core) y
// cómo se pinta por dentro. Se separan para que las dos vistas se vean igual (PLAN.md D20, D28).
//
// El bloque es tonal: su color de ESTADO llega como clase (`ec-status-*`, ver
// styles/main.scss) y el TIPO de visita como franja de color a la izquierda (`ec-kind-*`).
// Dentro solo van hora, mascota y cliente, sin íconos: el texto completo (estado, tipo,
// origen y empleado) va en el tooltip.
import type { CalendarBlock } from '@/lib/calendarGrid'

export function toCalendarEvents(blocks: CalendarBlock[]) {
  return blocks.map((block) => ({
    id: block.id,
    start: block.start,
    end: block.end,
    title: block.text,
    resourceIds: block.resource ? [block.resource] : [],
    classNames: [`ec-kind-${block.kind}`, `ec-status-${block.status}`],
    extendedProps: {
      kind: block.kind,
      status: block.status,
      customer: block.customer,
      pet: block.pet,
      origin: block.origin,
    },
  }))
}

// Contenido del bloque: hora y, en el título, la mascota y el cliente. Se arma con nodos del
// DOM y no con HTML porque el título lleva nombres de clientes y mascotas escritos por
// personas: como texto nunca se interpreta como HTML.
// Lo que EventCalendar entrega al pintar un evento (la librería no exporta ese tipo).
interface EventContentArg {
  event: { title: unknown; extendedProps: Record<string, unknown> }
  timeText: string
}

export function renderEventContent(info: EventContentArg): { domNodes: Node[] } {
  const props = info.event.extendedProps
  const pet = typeof props.pet === 'string' ? props.pet : ''
  const customer = typeof props.customer === 'string' ? props.customer : ''
  const nodes: Node[] = []

  if (info.timeText) {
    const time = document.createElement('div')
    time.className = 'ec-event-time'
    time.textContent = info.timeText
    nodes.push(time)
  }

  const title = document.createElement('div')
  title.className = 'ec-event-title'
  if (pet || customer) {
    if (pet) {
      const petName = document.createElement('strong')
      petName.textContent = pet
      title.appendChild(petName)
    }
    if (customer) {
      title.appendChild(document.createTextNode(pet ? ` · ${customer}` : customer))
    }
  } else {
    title.appendChild(document.createTextNode(String(info.event.title)))
  }
  nodes.push(title)

  return { domNodes: nodes }
}

// Iniciales para el avatar de un empleado: primera letra de las dos primeras palabras.
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  return words
    .slice(0, 2)
    .map((word) => word[0].toUpperCase())
    .join('')
}

// Encabezado de la fila de un empleado en la línea de tiempo: avatar con iniciales, nombre y
// cuántas citas tiene en el día. Texto del DOM, no HTML (el nombre lo escribe una persona).
export function renderResourceLabel(name: string, count: number): { domNodes: Node[] } {
  const wrap = document.createElement('div')
  wrap.className = 'ec-resource'

  const avatar = document.createElement('span')
  avatar.className = 'ec-resource-avatar'
  avatar.setAttribute('aria-hidden', 'true')
  avatar.textContent = initialsOf(name) || '?'

  const text = document.createElement('div')
  text.className = 'ec-resource-text'
  const nameEl = document.createElement('div')
  nameEl.className = 'ec-resource-name'
  nameEl.textContent = name
  const countEl = document.createElement('div')
  countEl.className = 'ec-resource-count'
  countEl.textContent =
    count === 0 ? 'Sin citas' : count === 1 ? '1 cita' : `${count} citas`
  text.append(nameEl, countEl)

  wrap.append(avatar, text)
  return { domNodes: [wrap] }
}
