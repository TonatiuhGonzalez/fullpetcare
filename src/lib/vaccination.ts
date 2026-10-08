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
export function computeNextDueDate(
  appliedAt: string,
  intervalDays: number | null,
): string | null {
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

/** Una fila de la cartilla en forma de tabla (fase 14): una por vacuna del catálogo. */
export interface VaccineTableRow {
  vaccineId: string
  vaccineName: string
  /** null si la mascota nunca se la ha aplicado. */
  appliedAt: string | null
  nextDueDate: string | null
  batchNumber: string | null
  status: VaccineStatus | null
}

interface CatalogVaccine {
  id: string
  name: string
}

interface AppliedVaccination {
  vaccine_id: string
  vaccineName: string
  applied_at: string
  next_due_date: string | null
  batch_number: string | null
}

/**
 * Arma la tabla de la cartilla: primero TODAS las vacunas del catálogo (las que
 * toca ofrecer para su especie), con los datos de su aplicación más reciente o
 * vacías si no se ha aplicado; después, las vacunas que la mascota sí recibió
 * pero ya no están en esa lista (por ejemplo, de otra especie o fuera del
 * catálogo), para no esconder nada del expediente.
 *
 * `vaccinations` puede venir en cualquier orden: aquí se elige la más reciente
 * por `applied_at`.
 */
export function buildVaccineTableRows(
  catalog: CatalogVaccine[],
  vaccinations: AppliedVaccination[],
  today: string,
): VaccineTableRow[] {
  const latestByVaccine = new Map<string, AppliedVaccination>()
  for (const vaccination of vaccinations) {
    const current = latestByVaccine.get(vaccination.vaccine_id)
    if (!current || vaccination.applied_at > current.applied_at) {
      latestByVaccine.set(vaccination.vaccine_id, vaccination)
    }
  }

  const toRow = (vaccineId: string, vaccineName: string): VaccineTableRow => {
    const applied = latestByVaccine.get(vaccineId)
    return {
      vaccineId,
      vaccineName,
      appliedAt: applied?.applied_at ?? null,
      nextDueDate: applied?.next_due_date ?? null,
      batchNumber: applied?.batch_number ?? null,
      status: applied ? classifyVaccineStatus(applied.next_due_date, today) : null,
    }
  }

  const rows = catalog.map((vaccine) => toRow(vaccine.id, vaccine.name))
  const inCatalog = new Set(catalog.map((vaccine) => vaccine.id))
  for (const [vaccineId, applied] of latestByVaccine) {
    if (!inCatalog.has(vaccineId)) rows.push(toRow(vaccineId, applied.vaccineName))
  }
  return rows
}
