// Estado que la agenda MUESTRA de una cita: su nombre, su ícono y el color del tema que le
// toca (PLAN.md D28). Es la única fuente: el bloque del calendario, la leyenda y los
// estilos de `styles/main.scss` (clases `ec-status-*`) salen de aquí.
//
// 'paid' no es un valor de `appointments.status` (ese enum nunca deja 'completed',
// CLAUDE.md §6.3/§8.5): es un estado SOLO VISUAL, "completada y además ya tiene una venta
// que la cubre". `agendaStatusOf()` es la única función que combina las dos cosas.
//
// Cada estado tiene su ícono y su nombre, y dos estados no comparten ícono aunque compartan
// color (cancelada y "no se presentó" son ambas rojas). El ícono se usa en la leyenda; el
// bloque del calendario no lo lleva (PLAN.md D28) y el nombre va en su tooltip.

export type AgendaStatus =
  'scheduled' | 'in_progress' | 'completed' | 'paid' | 'cancelled' | 'no_show'

export interface AgendaStatusInfo {
  status: AgendaStatus
  /** Texto para la persona usuaria, en español de México. */
  label: string
  /** Ícono de Material Design Icons (`mdi-…`). */
  icon: string
  /** Nombre del color en el tema de Vuetify; coincide con las claves de lib/palette.ts. */
  color: string
}

// "Agendada" es gris pizarra (`secondary`) y no azul: el azul queda solo para veterinaria
// y el naranja solo para estética (§5.6).
export const AGENDA_STATUSES: Record<AgendaStatus, AgendaStatusInfo> = {
  scheduled: {
    status: 'scheduled',
    label: 'Agendada',
    icon: 'mdi-clock-outline',
    color: 'secondary',
  },
  in_progress: {
    status: 'in_progress',
    label: 'En curso',
    icon: 'mdi-progress-clock',
    color: 'warning',
  },
  completed: {
    status: 'completed',
    label: 'Completada',
    icon: 'mdi-check',
    color: 'success',
  },
  paid: { status: 'paid', label: 'Cobrada', icon: 'mdi-cash-check', color: 'primary' },
  cancelled: {
    status: 'cancelled',
    label: 'Cancelada',
    icon: 'mdi-close-circle-outline',
    color: 'error',
  },
  no_show: {
    status: 'no_show',
    label: 'No se presentó',
    icon: 'mdi-account-off-outline',
    color: 'error',
  },
}

export function agendaStatusInfo(status: AgendaStatus): AgendaStatusInfo {
  return AGENDA_STATUSES[status]
}

/** El estado a MOSTRAR de una cita: su estado real, salvo que ya se cobró. */
export function agendaStatusOf(
  status: Exclude<AgendaStatus, 'paid'>,
  isPaid: boolean,
): AgendaStatus {
  return status === 'completed' && isPaid ? 'paid' : status
}
