// Reglas de reprogramar una cita (C1.13): las mismas que al agendar, revisadas en el
// formulario antes de llamar a la base.
//
// Funciones puras (CLAUDE.md §4): reciben el horario de la sucursal y "ahora" ya resueltos
// a hora local de la sucursal (§8.3), así que no leen reloj ni zona del navegador.
// La base repite estas reglas (`reschedule_appointment`) y manda; esto solo evita el viaje
// y da el mensaje al instante.

import { appointmentRuleMessage } from '@/lib/appointmentErrors'
import {
  fitsWithinHours,
  type BranchHours,
  type ExistingAppointment,
} from '@/lib/availability'
import { formatTime } from '@/lib/datetime'

export interface RescheduleProblemArgs {
  /** 'YYYY-MM-DD' y 'HH:mm' elegidos, hora local de la sucursal. Pueden venir vacíos. */
  date: string
  time: string
  durationMinutes: number
  /** Horario de la sucursal ESE día (`hoursForDate`); `null` si no abre. */
  branchHours: BranchHours | null
  /** Ahora mismo en la sucursal (`branchToday` y `formatTime(new Date(), tz)`). */
  now: { date: string; time: string }
}

// Los textos son los mismos con los que la base rechaza, para que no cambien según quién
// atrape el error primero.
const message = (hint: string, fallback: string): string =>
  appointmentRuleMessage({ hint }) ?? fallback

/**
 * El problema del horario elegido, en español, o `null` si se puede guardar. Orden: faltan
 * datos, ya pasó (sin tolerancia: justo ahora todavía vale), día cerrado, fuera de horario
 * (la cita completa, con su misma duración, debe caber).
 */
export function rescheduleProblem({
  date,
  time,
  durationMinutes,
  branchHours,
  now,
}: RescheduleProblemArgs): string | null {
  if (!date || !time) return 'Elige la fecha y la hora nuevas.'
  // 'YYYY-MM-DD' y 'HH:mm' ordenan como texto igual que el calendario.
  if (date < now.date || (date === now.date && time < now.time)) {
    return message('appointment_in_past', 'Ese horario ya pasó.')
  }
  if (!branchHours) return message('branch_closed_day', 'La sucursal no abre ese día.')
  if (!fitsWithinHours(branchHours, time, durationMinutes)) {
    return message(
      'outside_branch_hours',
      'La cita queda fuera del horario de la sucursal.',
    )
  }
  return null
}

export interface DayAppointment {
  id: string
  employee_user_id: string
  starts_at: string
  ends_at: string
  status: string
}

/**
 * Las citas del día contra las que se compara un traslape, en hora local de la sucursal:
 * sin la propia cita (si no, siempre chocaría consigo misma) y sin las canceladas o
 * no asistidas (no ocupan al empleado; así lo hacía la regla vieja de la base).
 */
export function overlapCandidates(
  appointments: DayAppointment[],
  selfId: string,
  branchTimezone: string,
): ExistingAppointment[] {
  return appointments
    .filter((a) => a.id !== selfId && a.status !== 'cancelled' && a.status !== 'no_show')
    .map((a) => ({
      employeeId: a.employee_user_id,
      startsAt: formatTime(a.starts_at, branchTimezone),
      endsAt: formatTime(a.ends_at, branchTimezone),
    }))
}
