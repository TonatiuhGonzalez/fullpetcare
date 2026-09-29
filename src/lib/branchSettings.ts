// Lógica pura del formulario de sucursal (tarea #1959): convertir el horario
// entre la forma que guarda la base y la forma que edita el formulario, y
// validar los datos antes de guardar.
//
// Es pura (sin red, sin Vue) por la regla de capas de CLAUDE.md §4: entra un
// objeto, sale un objeto, y se prueba sin levantar nada.
import type { BranchHours } from '@/lib/availability'
import { isValidPhone, isValidPostalCode } from '@/lib/validation'

/** Claves de `branches.opening_hours`, en el orden que se muestran (lunes primero). */
export const WEEKDAYS = [
  { key: 'monday', label: 'Lunes' },
  { key: 'tuesday', label: 'Martes' },
  { key: 'wednesday', label: 'Miércoles' },
  { key: 'thursday', label: 'Jueves' },
  { key: 'friday', label: 'Viernes' },
  { key: 'saturday', label: 'Sábado' },
  { key: 'sunday', label: 'Domingo' },
] as const

export type WeekdayKey = (typeof WEEKDAYS)[number]['key']

/**
 * Zonas horarias IANA que se pueden elegir (CLAUDE.md §8.3: nombres IANA,
 * nunca offsets fijos).
 */
export const BRANCH_TIMEZONES = [
  { value: 'America/Mexico_City', title: 'Centro (Ciudad de México)' },
  { value: 'America/Cancun', title: 'Sureste (Cancún)' },
  { value: 'America/Hermosillo', title: 'Pacífico (Hermosillo)' },
  { value: 'America/Tijuana', title: 'Noroeste (Tijuana)' },
] as const

/** Un día del formulario: `isOpen` false = cerrado ese día. */
export interface DayHoursForm {
  isOpen: boolean
  opensAt: string
  closesAt: string
}

export type HoursForm = Record<WeekdayKey, DayHoursForm>

const DEFAULT_OPENS_AT = '09:00'
const DEFAULT_CLOSES_AT = '18:00'

/**
 * Horario inicial de una sucursal nueva: lunes a sábado 09:00–18:00 y domingo
 * cerrado (el mismo horario típico de la semilla). Es solo un punto de partida
 * que el dueño ajusta.
 */
export function defaultHoursForm(): HoursForm {
  return Object.fromEntries(
    WEEKDAYS.map(({ key }) => [
      key,
      { isOpen: key !== 'sunday', opensAt: DEFAULT_OPENS_AT, closesAt: DEFAULT_CLOSES_AT },
    ]),
  ) as HoursForm
}

/**
 * Del jsonb de la base al formulario. Un día ausente, `null` o con una forma
 * que no reconocemos se muestra cerrado — igual que `hoursForDate()` en
 * availability.ts lo trata al agendar (sin horario = no abre).
 */
export function hoursToForm(
  openingHours: Record<string, BranchHours | null | undefined> | null | undefined,
): HoursForm {
  const form = defaultHoursForm()
  for (const { key } of WEEKDAYS) {
    const day = openingHours?.[key]
    if (day && typeof day.opensAt === 'string' && typeof day.closesAt === 'string') {
      form[key] = { isOpen: true, opensAt: day.opensAt, closesAt: day.closesAt }
    } else {
      form[key] = { ...form[key], isOpen: false }
    }
  }
  return form
}

/** Del formulario al jsonb de la base: los días cerrados se guardan como `null`. */
export function formToHours(form: HoursForm): Record<WeekdayKey, BranchHours | null> {
  return Object.fromEntries(
    WEEKDAYS.map(({ key }) => {
      const day = form[key]
      return [key, day.isOpen ? { opensAt: day.opensAt, closesAt: day.closesAt } : null]
    }),
  ) as Record<WeekdayKey, BranchHours | null>
}

export interface BranchFormInput {
  name: string
  address: string
  postalCode: string
  phone: string
  timezone: string
  hours: HoursForm
}

export type BranchFormField = 'name' | 'postalCode' | 'phone' | 'timezone' | 'hours'

export interface BranchFormProblem {
  field: BranchFormField
  message: string
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/

/**
 * Problemas del formulario, en español y sin jerga. Solo el nombre es
 * obligatorio; dirección, código postal y teléfono pueden ir vacíos pero, si se
 * capturan, deben tener forma válida. Un horario necesita `HH:mm` y que cierre
 * después de abrir; además, al menos un día abierto (una sucursal que nunca
 * abre no se podría agendar).
 */
export function branchFormProblems(input: BranchFormInput): BranchFormProblem[] {
  const problems: BranchFormProblem[] = []

  if (input.name.trim() === '') {
    problems.push({ field: 'name', message: 'Escribe el nombre de la sucursal.' })
  }
  if (input.postalCode.trim() !== '' && !isValidPostalCode(input.postalCode)) {
    problems.push({ field: 'postalCode', message: 'El código postal debe tener 5 dígitos.' })
  }
  if (input.phone.trim() !== '' && !isValidPhone(input.phone)) {
    problems.push({ field: 'phone', message: 'El teléfono debe tener 10 dígitos.' })
  }
  if (!BRANCH_TIMEZONES.some((tz) => tz.value === input.timezone)) {
    problems.push({ field: 'timezone', message: 'Elige la zona horaria de la sucursal.' })
  }

  const openDays = WEEKDAYS.filter(({ key }) => input.hours[key].isOpen)
  if (openDays.length === 0) {
    problems.push({ field: 'hours', message: 'La sucursal debe abrir al menos un día.' })
  }
  for (const { key, label } of openDays) {
    const { opensAt, closesAt } = input.hours[key]
    if (!HHMM.test(opensAt) || !HHMM.test(closesAt)) {
      problems.push({ field: 'hours', message: `${label}: escribe la hora de apertura y de cierre.` })
    } else if (closesAt <= opensAt) {
      // "HH:mm" con ceros a la izquierda se compara bien como texto.
      problems.push({ field: 'hours', message: `${label}: el cierre debe ser después de la apertura.` })
    }
  }

  return problems
}
