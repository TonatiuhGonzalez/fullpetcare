// Conversión entre instantes UTC (lo que guarda la base) y hora local de
// una sucursal (lo que ve una persona) — CLAUDE.md §8.3. Funciones puras:
// no leen el reloj del sistema salvo cuando se les pide explícitamente
// (dayRangeUtc con "hoy"), y todo lo demás depende solo de sus
// argumentos.
//
// =============================================================================
// Por qué la base guarda UTC y no la hora "de México"
// =============================================================================
// Postgres guarda un `timestamptz` como un instante absoluto (internamente,
// segundos desde una época fija) — no le pertenece a ningún huso horario.
// "Hora local" es una interpretación que se decide SOLO al mostrar: el
// mismo instante son las 14:30 en Tijuana y las 15:30 en CDMX
// simultáneamente, y ambas lecturas son correctas. Si la base guardara
// "hora de México" directamente, agendar una cita en Tijuana y mostrarla
// en CDMX (el dueño revisando la agenda de otra sucursal, algo que esta
// app permite) requeriría convertir a mano en cada consulta, con muchas
// más oportunidades de error que convertir una sola vez, al mostrar.
//
// =============================================================================
// Por qué la zona de la SUCURSAL y no la del navegador
// =============================================================================
// La hora que importa es la del NEGOCIO, no la de quien está mirando la
// pantalla — si el dueño de Patitas Felices (CDMX) revisa desde su
// celular la agenda de Huellitas Spa (Tijuana), la cita de las 14:30
// debe seguir mostrando 14:30 (la hora en la que de verdad llega el
// cliente a Tijuana), no reinterpretarse a la hora de CDMX solo porque
// ahí está el navegador. Por eso todas las funciones de aquí piden la
// zona de la sucursal como argumento explícito — nunca usan
// `Intl.DateTimeFormat().resolvedOptions().timeZone` (la zona del
// navegador) ni la del servidor.
//
// =============================================================================
// Por qué nombre IANA ("America/Tijuana") y no un offset fijo ("-08:00")
// =============================================================================
// Un offset fijo describe SOLO un momento del año. México eliminó el
// horario de verano en 2022 — EXCEPTO en la franja fronteriza (Tijuana,
// Mexicali, etc.), que lo sigue aplicando para alinearse con el horario
// de EE.UU. Eso significa que Tijuana SÍ cambia de offset dos veces al
// año (UTC-8 en invierno, UTC-7 en verano) mientras CDMX se queda fija
// en UTC-6 todo el año. Un nombre IANA como "America/Tijuana" carga esa
// REGLA completa (cuándo cambia, y a qué), no un número congelado —
// TZDate (de @date-fns/tz) sabe leer esa regla y aplicar el offset
// correcto según la fecha. Guardar "-08:00" a secas se rompería en
// cuanto Tijuana entrara a horario de verano, dos veces al año.
//
// =============================================================================
// El detalle que sí importa de la API de TZDate
// =============================================================================
// `new TZDate("2026-07-15T14:30:00", "America/Tijuana")` NO hace lo que
// parece — un string SIN 'Z' ni offset se interpreta con las mismas
// reglas ambiguas que `new Date(unString)`, que caen en la zona horaria
// del SISTEMA que ejecuta el código (el servidor, o la Mac de quien esté
// corriendo los tests), NO en "America/Tijuana". Verificado a mano:
// da un resultado silenciosamente distinto según en qué máquina corra.
//
// La forma correcta es pasar los componentes NUMÉRICOS por separado —
// año, mes (0-indexado, como el `Date` nativo), día, hora, minutos — con
// la zona como último argumento: `new TZDate(2026, 6, 15, 14, 30, 0,
// "America/Tijuana")`. Así SÍ se interpreta como "las 14:30 de esa
// fecha, en esa zona", sin pasar por ninguna zona intermedia.
import { TZDate } from '@date-fns/tz'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'

/**
 * Convierte un instante UTC (lo que devuelve Supabase: un string ISO con
 * 'Z' u offset explícito, o un Date) a un TZDate — un objeto tipo Date
 * que, al leerlo (getHours(), format(), etc.), muestra la hora de esa
 * sucursal. Un string CON offset se parsea sin ambigüedad (el offset ya
 * dice a qué instante se refiere) — el problema de arriba es solo con
 * strings SIN offset.
 */
export function toBranchTime(utcInstant: Date | string, branchTimezone: string): TZDate {
  return new TZDate(utcInstant, branchTimezone)
}

/**
 * Construye el instante UTC correcto a partir de una fecha y hora
 * LOCALES de la sucursal — lo que hace falta al agendar una cita: la
 * recepcionista elige "15 de julio, 14:30" pensando en la hora de SU
 * sucursal, y hay que guardar el instante UTC equivalente.
 *
 * @param dateStr 'YYYY-MM-DD'
 * @param timeStr 'HH:mm'
 */
export function fromBranchTime(
  dateStr: string,
  timeStr: string,
  branchTimezone: string,
): Date {
  const [year, month, day] = dateStr.split('-').map(Number)
  const [hour, minute] = timeStr.split(':').map(Number)
  const local = new TZDate(year, month - 1, day, hour, minute, 0, branchTimezone)
  // Se devuelve un Date normal (no un TZDate) porque, de aquí en
  // adelante, esto va derecho a un INSERT/UPDATE — Supabase solo
  // necesita el instante, no la zona con la que se construyó.
  return new Date(local.getTime())
}

/** Hora local de la sucursal, formato de 24 horas ("14:30"). */
export function formatTime(utcInstant: Date | string, branchTimezone: string): string {
  return format(toBranchTime(utcInstant, branchTimezone), 'HH:mm')
}

/** Fecha local de la sucursal en español ("15 de julio de 2026"). */
export function formatDate(utcInstant: Date | string, branchTimezone: string): string {
  return format(toBranchTime(utcInstant, branchTimezone), "d 'de' MMMM 'de' yyyy", {
    locale: es,
  })
}

/**
 * El rango [inicio, fin) en UTC de un día calendario de la sucursal —
 * lo que necesita "la agenda del día" (tarea 3.17): un `where starts_at
 * >= startUtc and starts_at < endUtc`. No es "medianoche UTC a
 * medianoche UTC" — es medianoche EN LA ZONA DE LA SUCURSAL, que cae en
 * un instante UTC distinto según la sucursal (y, en Tijuana, según la
 * época del año).
 *
 * @param dateStr 'YYYY-MM-DD', el día calendario en la sucursal
 */
export function dayRangeUtc(
  dateStr: string,
  branchTimezone: string,
): { startUtc: Date; endUtc: Date } {
  const [year, month, day] = dateStr.split('-').map(Number)
  const startLocal = new TZDate(year, month - 1, day, 0, 0, 0, branchTimezone)
  // day + 1 se sale de rango de días válidos del mes (p. ej. el 32 de
  // enero) — igual que el Date nativo, TZDate lo normaliza solo al
  // siguiente mes correcto (1 de febrero). No hace falta lógica de
  // calendario a mano.
  const endLocal = new TZDate(year, month - 1, day + 1, 0, 0, 0, branchTimezone)
  return { startUtc: new Date(startLocal.getTime()), endUtc: new Date(endLocal.getTime()) }
}
