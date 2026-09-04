// Cálculo de la próxima dosis y qué tan urgente es (CLAUDE.md §1: "cartilla
// de vacunación con recordatorios"). Función pura: recibe fechas como
// texto 'YYYY-MM-DD' y nunca lee el reloj del sistema — quien llama pasa
// "hoy" explícito, igual que lib/availability.ts recibe el horario ya
// resuelto en vez de calcularlo. Son fechas de calendario (CLAUDE.md
// §8.3: next_due_date es `date`, no `timestamptz` — "el 15 de marzo" no
// tiene zona horaria), así que no hace falta ninguna de la maquinaria de
// zonas horarias de lib/datetime.ts aquí.
import { addDays, differenceInCalendarDays, parseISO, format } from 'date-fns'

/**
 * A partir de cuándo se aplicó una vacuna y cada cuánto se refuerza,
 * calcula la fecha de la siguiente dosis. `null` si la vacuna no tiene
 * un intervalo definido (CLAUDE.md: algunas vacunas se aplican una sola
 * vez, sin refuerzo calculable — `vaccines.default_interval_days` es
 * nullable justo por esto).
 */
export function computeNextDueDate(appliedAt: string, intervalDays: number | null): string | null {
  if (intervalDays == null) return null
  return format(addDays(parseISO(appliedAt), intervalDays), 'yyyy-MM-dd')
}

export type VaccineStatus = 'current' | 'due_soon' | 'overdue'

/**
 * Clasifica una fecha de próxima dosis en vigente / por vencer / vencida.
 * `null` si no hay fecha que clasificar (vacuna sin intervalo definido —
 * `computeNextDueDate` ya devolvió `null` para ella, no hay "vencido" ni
 * "vigente" que calcular).
 *
 * @param dueSoonWindowDays cuántos días antes de vencer se considera
 * "por vencer" — 30 por default (un mes de aviso).
 */
export function classifyVaccineStatus(
  nextDueDate: string | null,
  today: string,
  dueSoonWindowDays = 30,
): VaccineStatus | null {
  if (!nextDueDate) return null

  const daysUntilDue = differenceInCalendarDays(parseISO(nextDueDate), parseISO(today))

  // "Vence hoy" (daysUntilDue === 0) cuenta como "por vencer", no como
  // "vencida" todavía — el día no ha terminado. Recién al día siguiente
  // (daysUntilDue < 0) pasa a vencida.
  if (daysUntilDue < 0) return 'overdue'
  if (daysUntilDue <= dueSoonWindowDays) return 'due_soon'
  return 'current'
}
