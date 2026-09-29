// Para una visita sin cita: ¿qué empleado puede atender YA, y a quién le
// toca esperar cuánto? Función pura, mismo criterio que availability.ts:
// no lee el reloj ni llama a Supabase. Quien la usa le pasa "qué hora es"
// y las citas ya cargadas, todo en 'HH:mm' locales de la sucursal (la
// conversión de UTC a hora local ya la hizo lib/datetime.ts).
//
// Diferencia con computeAvailableSlots: allá se buscan huecos dentro del
// horario de la sucursal en pasos de 30 minutos. Aquí NO importa el
// horario de apertura (una emergencia puede llegar fuera de horario) ni
// los pasos: se busca el primer minuto, desde ahora, en que el empleado
// tiene libre la duración completa de lo que se va a hacer.

export interface WalkInBusyRange {
  employeeId: string
  /** 'HH:mm', hora local de la sucursal. */
  startsAt: string
  endsAt: string
}

export interface EmployeeWait {
  employeeId: string
  /** 'HH:mm': cuándo podría empezar este empleado. */
  startsAt: string
  endsAt: string
  /** Minutos desde "ahora" hasta `startsAt`. 0 = puede atender ya. */
  waitMinutes: number
}

export interface ComputeEmployeeWaitsArgs {
  employeeIds: string[]
  /**
   * Citas que ocupan tiempo de cualquier empleado (la función filtra por
   * empleado). Quien llama debe excluir las canceladas y las "no se
   * presentó": esas dejan el horario libre de verdad.
   */
  busyRanges: WalkInBusyRange[]
  /** 'HH:mm', la hora local de la sucursal en este momento. */
  nowTime: string
  durationMinutes: number
}

const MINUTES_PER_DAY = 24 * 60

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
 * Para cada empleado, el primer instante desde ahora en que puede
 * empezar a atender `durationMinutes`, ordenados del que menos espera al
 * que más. Quien no alcanza a terminar antes de medianoche queda fuera:
 * las citas del proyecto son de un solo día calendario.
 *
 * Con empate en la espera, se respeta el orden en que llegó `employeeIds`
 * (el orden de un sort es estable), así la lista no "baila" entre
 * recargas.
 */
export function computeEmployeeWaits({
  employeeIds,
  busyRanges,
  nowTime,
  durationMinutes,
}: ComputeEmployeeWaitsArgs): EmployeeWait[] {
  if (durationMinutes <= 0) return []

  const now = parseMinutes(nowTime)
  const waits: EmployeeWait[] = []

  for (const employeeId of employeeIds) {
    const busy = busyRanges
      .filter((range) => range.employeeId === employeeId)
      .map((range) => ({ start: parseMinutes(range.startsAt), end: parseMinutes(range.endsAt) }))

    // Se empieza a "ahora" y, mientras el tramo choque con una cita, se
    // recorre al final de la que choca. Cada vuelta avanza al menos un
    // minuto (el fin de una cita choca solo si es mayor que `start`), así
    // que termina siempre. Traslape con "<" / ">" estrictos, igual que
    // availability.ts y create_appointment(): terminar justo cuando otra
    // empieza no es choque.
    let start = now
    for (;;) {
      const end = start + durationMinutes
      const clashing = busy.filter((range) => start < range.end && end > range.start)
      if (clashing.length === 0) break
      start = Math.max(...clashing.map((range) => range.end))
    }

    const end = start + durationMinutes
    if (end > MINUTES_PER_DAY) continue

    waits.push({
      employeeId,
      startsAt: formatMinutes(start),
      endsAt: formatMinutes(end),
      waitMinutes: start - now,
    })
  }

  return waits.sort((a, b) => a.waitMinutes - b.waitMinutes)
}

/** Texto para mostrar la espera de un empleado ("Libre ahora", "Espera ~45 min"). */
export function waitLabel(waitMinutes: number): string {
  if (waitMinutes <= 0) return 'Libre ahora'
  if (waitMinutes < 60) return `Espera ~${waitMinutes} min`
  const hours = Math.floor(waitMinutes / 60)
  const minutes = waitMinutes % 60
  return minutes === 0 ? `Espera ~${hours} h` : `Espera ~${hours} h ${minutes} min`
}
