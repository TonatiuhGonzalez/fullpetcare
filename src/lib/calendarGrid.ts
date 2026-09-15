// Aritmética pura para decidir QUÉ rango de fechas y de horas debe pintar
// la agenda (rediseño con @daypilot/daypilot-lite-vue: DayPilotScheduler
// para dueño/recepción, DayPilotCalendar para groomer/vet — ver
// components/EmployeeDayScheduler.vue y EmployeeWeekCalendar.vue). Nada
// de esto lee el reloj del sistema ni sabe de DayPilot: todo depende
// solo de sus argumentos, así que se prueba sin levantar nada (CLAUDE.md
// §4 y §9). El acomodo de citas traslapadas (columnas lado a lado) ya no
// vive aquí — el propio DayPilotScheduler/DayPilotCalendar lo resuelve
// solo, es justo la razón de usar un componente de verdad en vez del
// grid hecho a mano de la versión anterior.
import { addDays, format } from 'date-fns'

import type { BranchHours } from './availability'

/**
 * `count` días consecutivos ('YYYY-MM-DD') empezando en `startDateStr`,
 * SIN alinear a lunes — a diferencia de una "semana calendario", esto es
 * lo que necesita groomer/vet (tarea de rediseño: "de la fecha actual a
 * siete días hacia adelante", no la semana de lunes a domingo que la
 * fecha caiga).
 */
export function consecutiveDates(startDateStr: string, count: number): string[] {
  const [year, month, day] = startDateStr.split('-').map(Number)
  const start = new Date(year, month - 1, day)
  return Array.from({ length: count }, (_, i) => format(addDays(start, i), 'yyyy-MM-dd'))
}

export interface HourRange {
  startMinutes: number
  endMinutes: number
}

// Si ningún día visible abre (negocio cerrado esos días, o sin datos de
// horario todavía), la grilla necesita ALGÚN rango para no quedar en
// blanco. 09:00-18:00 es el horario típico de la semilla (seed.sql) — un
// default razonable, no una regla de negocio.
const FALLBACK_RANGE: HourRange = { startMinutes: 9 * 60, endMinutes: 18 * 60 }

function toMinutes(hhmm: string): number {
  const [hours, minutes] = hhmm.split(':').map(Number)
  return hours * 60 + minutes
}

/**
 * El rango de horas a mostrar: la UNIÓN de los horarios de apertura de
 * los días visibles, no el de un solo día — si el sábado cierra más
 * temprano que el resto de la semana, la grilla sigue necesitando llegar
 * hasta la hora de cierre más tardía para mostrar completo el horario
 * largo de los demás días. Para la vista de dueño/recepción (un solo
 * día) se llama con un arreglo de un solo elemento, y el resultado es
 * simplemente el horario de ESE día.
 */
export function visibleHourRange(dailyHours: Array<BranchHours | null>): HourRange {
  const openDays = dailyHours.filter((hours): hours is BranchHours => hours !== null)
  if (openDays.length === 0) return FALLBACK_RANGE

  return {
    startMinutes: Math.min(...openDays.map((hours) => toMinutes(hours.opensAt))),
    endMinutes: Math.max(...openDays.map((hours) => toMinutes(hours.closesAt))),
  }
}

/**
 * Un evento ya traducido al vocabulario de DayPilot (EmployeeDayScheduler.vue,
 * EmployeeWeekCalendar.vue) — lo arma AgendaPage.vue a partir de un
 * AppointmentWithNames. `start`/`end` YA son hora local de la sucursal
 * SIN zona (lib/datetime.ts#toNaiveLocalIso) — ninguno de los dos
 * componentes de DayPilot sabe nada de timezones. `resource` solo lo usa
 * EmployeeDayScheduler (el id de fila/empleado); EmployeeWeekCalendar lo
 * ignora, ahí cada groomer/vet solo ve sus propias citas.
 */
export interface CalendarBlock {
  id: string
  start: string
  end: string
  text: string
  color: string
  resource?: string
}
