// Resumen del día para la pantalla Inicio (fase 15, PLAN.md D20 punto 8). Funciones
// puras: reciben las citas de hoy ya cargadas y devuelven conteos y listas. No saben
// de Supabase ni de Vue (CLAUDE.md §4), por eso son fáciles de probar.
//
// Una cita "cobrada" no es un estado de `appointments.status`: ese estado se queda en
// `completed` y el cobro se detecta aparte (hay una venta que la cubre). Por eso todo
// aquí recibe el conjunto `paidIds` con las citas ya cobradas.

type Status = 'scheduled' | 'in_progress' | 'completed' | 'cancelled' | 'no_show'

export interface SummaryAppointment {
  id: string
  status: Status
  starts_at: string
}

export interface DaySummary {
  // Citas que sí cuentan para el día: todas menos canceladas y no asistidas.
  total: number
  scheduled: number
  inProgress: number
  // Atendidas pero todavía sin cobrar.
  awaitingPayment: number
  paid: number
  // Canceladas y "no se presentó" (no cuentan en `total`).
  cancelled: number
}

export function summarizeDay(
  appointments: SummaryAppointment[],
  paidIds: Set<string>,
): DaySummary {
  const summary: DaySummary = {
    total: 0,
    scheduled: 0,
    inProgress: 0,
    awaitingPayment: 0,
    paid: 0,
    cancelled: 0,
  }
  for (const a of appointments) {
    if (a.status === 'cancelled' || a.status === 'no_show') {
      summary.cancelled += 1
      continue
    }
    summary.total += 1
    if (a.status === 'scheduled') summary.scheduled += 1
    else if (a.status === 'in_progress') summary.inProgress += 1
    else if (paidIds.has(a.id)) summary.paid += 1
    else summary.awaitingPayment += 1
  }
  return summary
}

// Las que siguen del día: agendadas y en curso, por hora de inicio. `limit` evita
// llenar la pantalla en un día con muchas citas.
export function upcomingAppointments<T extends SummaryAppointment>(
  appointments: T[],
  limit: number,
): T[] {
  return appointments
    .filter((a) => a.status === 'scheduled' || a.status === 'in_progress')
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
    .slice(0, limit)
}

// Atendidas que todavía no tienen venta: lo que falta cobrar.
export function awaitingPayment<T extends SummaryAppointment>(
  appointments: T[],
  paidIds: Set<string>,
): T[] {
  return appointments
    .filter((a) => a.status === 'completed' && !paidIds.has(a.id))
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
}

export interface PricedService {
  appointment_id: string
  unit_price_cents: number
  quantity: number
}

// Total ESTIMADO por cobrar: solo los servicios de esas citas (el precio ya incluye
// IVA, CLAUDE.md §8.2). No incluye productos que se agreguen al cobrar ni descuentos,
// por eso la pantalla lo presenta como estimado. Centavos enteros, sin decimales.
export function estimatedPendingCents(
  pendingAppointmentIds: string[],
  services: PricedService[],
): number {
  const wanted = new Set(pendingAppointmentIds)
  return services
    .filter((s) => wanted.has(s.appointment_id))
    .reduce((sum, s) => sum + s.unit_price_cents * s.quantity, 0)
}
