// Calcula qué huecos de horario están libres para agendar un servicio
// con un empleado, en un día y una sucursal dados.
//
// =============================================================================
// Por qué esto es una función PURA, y por qué eso importa
// =============================================================================
// "Pura" quiere decir: la salida depende SOLO de los argumentos — nada
// de leer el reloj del sistema, nada de llamar a Supabase, nada de
// tocar el DOM. Toda la información que necesita (el horario de la
// sucursal ESE día, las citas que ya existen) se la pasa quien llama.
//
// Esto la vuelve trivial de probar (tarea 3.7): un test de esta función
// es "le doy estos datos, compruebo que regresa esto otro" — no hace
// falta Supabase local corriendo, ni Docker, ni una base de datos con
// datos de prueba, ni preocuparse por en qué zona horaria corre el test
// (los horarios ya llegan en 'HH:mm' locales de la sucursal — la
// conversión de UTC a hora local ya la hizo lib/datetime.ts ANTES de
// llamar a esta función, así que availability.ts no sabe nada de zonas
// horarias ni de Date; trabaja con minutos desde medianoche, aritmética
// simple). Comparar eso con probar "¿el selector de horarios de la UI
// muestra los huecos correctos?" sin esta separación: habría que armar
// citas reales en la base, filtrar por zona horaria, y renderizar un
// componente — mucho más lento y mucho más frágil.
//
// La regla general (CLAUDE.md §4): toda la lógica que se pueda expresar
// como función pura va en lib/. Es donde vive el valor real de las
// pruebas del proyecto.

export interface BranchHours {
  /** 'HH:mm', hora local de la sucursal. */
  opensAt: string
  closesAt: string
}

export interface ExistingAppointment {
  employeeId: string
  /** 'HH:mm', hora local de la sucursal — mismo criterio que BranchHours. */
  startsAt: string
  endsAt: string
}

export interface AvailableSlot {
  startsAt: string
  endsAt: string
}

export interface ComputeAvailableSlotsArgs {
  /** Horario de la sucursal ESE día. `null` si ese día no abre. */
  branchHours: BranchHours | null
  /**
   * Las citas ya agendadas — de CUALQUIER empleado; la función filtra
   * internamente por `employeeId`. Así quien llama puede cargar "todas
   * las citas de hoy en esta sucursal" una sola vez y pedir los huecos
   * de varios empleados sin repetir la consulta.
   */
  existingAppointments: ExistingAppointment[]
  employeeId: string
  durationMinutes: number
  /** Cada cuántos minutos se ofrece un horario de inicio (p. ej. 15 o 30). */
  stepMinutes: number
}

function parseMinutes(hhmm: string): number {
  const [hours, minutes] = hhmm.split(':').map(Number)
  return hours * 60 + minutes
}

function formatMinutes(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

/**
 * true si [aStart, aEnd) se traslapa con [bStart, bEnd). Los extremos NO
 * cuentan como traslape a propósito: una cita que termina a las 10:00 y
 * otra que empieza a las 10:00 no se encima, comparten el instante de
 * cambio pero ningún minuto real. Por eso son "<" y ">" estrictos, no
 * "<=" / ">=".
 */
function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && aEnd > bStart
}

export function computeAvailableSlots({
  branchHours,
  existingAppointments,
  employeeId,
  durationMinutes,
  stepMinutes,
}: ComputeAvailableSlotsArgs): AvailableSlot[] {
  if (!branchHours) return []
  if (durationMinutes <= 0) return []
  if (stepMinutes <= 0) return []

  const opensAt = parseMinutes(branchHours.opensAt)
  const closesAt = parseMinutes(branchHours.closesAt)

  const busyRanges = existingAppointments
    .filter((a) => a.employeeId === employeeId)
    .map((a) => ({ start: parseMinutes(a.startsAt), end: parseMinutes(a.endsAt) }))

  const slots: AvailableSlot[] = []

  for (let start = opensAt; start + durationMinutes <= closesAt; start += stepMinutes) {
    const end = start + durationMinutes
    const isBusy = busyRanges.some((busy) => overlaps(start, end, busy.start, busy.end))
    if (!isBusy) {
      slots.push({ startsAt: formatMinutes(start), endsAt: formatMinutes(end) })
    }
  }

  return slots
}

export type SlotStatus = 'free' | 'overlap' | 'past'

export interface SlotWithStatus {
  startsAt: string
  endsAt: string
  status: SlotStatus
  /** Solo con `status === 'overlap'`: la primera cita del mismo empleado con la que choca. */
  conflict?: { startsAt: string; endsAt: string }
}

export interface ComputeSlotStatusesArgs extends ComputeAvailableSlotsArgs {
  /** Día de los huecos, 'YYYY-MM-DD' (fecha local de la sucursal). */
  date: string
  /** Ahora mismo en la sucursal. Se recibe como argumento: la función no lee el reloj. */
  now: { date: string; time: string }
}

/**
 * Igual que `computeAvailableSlots` (misma rejilla, mismo criterio de cierre), pero
 * NO oculta nada: devuelve todos los huecos con su estado para que la interfaz
 * pueda mostrar los ocupados deshabilitados y explicar por qué.
 *
 * - `past`: el inicio es anterior a la hora actual (sin tolerancia; justo ahora
 *   todavía es elegible). Fecha anterior a hoy: todos; posterior: ninguno. Gana
 *   sobre `overlap`: un hueco pasado no se puede elegir de todos modos.
 * - `overlap`: choca con una cita del MISMO empleado (extremos que se tocan, no).
 * - `free`: el resto.
 *
 * Comparar 'YYYY-MM-DD' como texto funciona porque el formato ordena igual que
 * el calendario.
 */
export function computeSlotStatuses({
  branchHours,
  existingAppointments,
  employeeId,
  durationMinutes,
  stepMinutes,
  date,
  now,
}: ComputeSlotStatusesArgs): SlotWithStatus[] {
  if (!branchHours) return []
  if (durationMinutes <= 0) return []
  if (stepMinutes <= 0) return []

  const opensAt = parseMinutes(branchHours.opensAt)
  const closesAt = parseMinutes(branchHours.closesAt)

  const busyRanges = existingAppointments
    .filter((a) => a.employeeId === employeeId)
    .map((a) => ({ start: parseMinutes(a.startsAt), end: parseMinutes(a.endsAt), raw: a }))

  const nowMinutes = parseMinutes(now.time)
  const slots: SlotWithStatus[] = []

  for (let start = opensAt; start + durationMinutes <= closesAt; start += stepMinutes) {
    const end = start + durationMinutes
    const slot: SlotWithStatus = {
      startsAt: formatMinutes(start),
      endsAt: formatMinutes(end),
      status: 'free',
    }

    const isPast = date < now.date || (date === now.date && start < nowMinutes)
    const conflict = busyRanges.find((busy) => overlaps(start, end, busy.start, busy.end))

    if (isPast) {
      slot.status = 'past'
    } else if (conflict) {
      slot.status = 'overlap'
      slot.conflict = { startsAt: conflict.raw.startsAt, endsAt: conflict.raw.endsAt }
    }
    slots.push(slot)
  }

  return slots
}

// Claves de branches.opening_hours (jsonb), una por día de la semana —
// el mismo día que devuelve Date.getDay() en JS (0 = domingo). Cada
// valor es un BranchHours o null (cerrado ese día).
const WEEKDAY_KEYS = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
] as const

/**
 * El horario de una sucursal para una fecha calendario concreta —
 * traduce el jsonb "una entrada por día de la semana" a lo que
 * `computeAvailableSlots` necesita. `dateStr` es 'YYYY-MM-DD'; no hace
 * falta convertir zonas horarias aquí porque ya representa el día
 * calendario correcto en la sucursal (esa conversión ya pasó al elegir
 * la fecha) — es aritmética de calendario pura, no de instantes.
 */
export function hoursForDate(
  openingHours: Record<string, BranchHours | null | undefined>,
  dateStr: string,
): BranchHours | null {
  const [year, month, day] = dateStr.split('-').map(Number)
  const dayOfWeek = new Date(year, month - 1, day).getDay()
  return openingHours[WEEKDAY_KEYS[dayOfWeek]] ?? null
}

export interface FindOverlapArgs {
  /** Citas del día — de CUALQUIER empleado; la función filtra por `employeeId`. */
  existingAppointments: ExistingAppointment[]
  employeeId: string
  /** 'HH:mm', hora local de la sucursal, del horario que se quiere revisar. */
  startsAt: string
  endsAt: string
}

/**
 * La primera cita del MISMO empleado con la que choca el horario [startsAt, endsAt), o
 * `null` si no choca con ninguna. Es la misma regla que `computeSlotStatuses` (extremos
 * que se tocan no cuentan), pero para UN horario libre: lo que necesita reprogramar,
 * donde la hora no sale de una rejilla de huecos. Solo avisa; no decide si se permite
 * (D26 punto 1: el traslape se permite con aviso). Quien llama excluye antes la propia
 * cita y las canceladas o no asistidas.
 */
export function findOverlap({
  existingAppointments,
  employeeId,
  startsAt,
  endsAt,
}: FindOverlapArgs): ExistingAppointment | null {
  const start = parseMinutes(startsAt)
  const end = parseMinutes(endsAt)
  return (
    existingAppointments.find(
      (a) =>
        a.employeeId === employeeId &&
        overlaps(start, end, parseMinutes(a.startsAt), parseMinutes(a.endsAt)),
    ) ?? null
  )
}

/**
 * true si una cita que empieza a `startsAt` ('HH:mm') y dura `durationMinutes` cabe
 * completa dentro del horario de la sucursal ese día. Con `branchHours` nulo (día
 * cerrado) nunca cabe. A diferencia de `computeAvailableSlots` no exige que `startsAt`
 * caiga en la rejilla de pasos: al reprogramar la hora es libre.
 */
export function fitsWithinHours(
  branchHours: BranchHours | null,
  startsAt: string,
  durationMinutes: number,
): boolean {
  if (!branchHours) return false
  const start = parseMinutes(startsAt)
  return (
    start >= parseMinutes(branchHours.opensAt) &&
    start + durationMinutes <= parseMinutes(branchHours.closesAt)
  )
}
