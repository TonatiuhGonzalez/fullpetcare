// Reglas de la hospitalización (fase 33, PLAN.md D30 punto 10). Funciones puras: son las MISMAS
// que aplica la base (migración 20261028120000_hospitalization.sql) y viven aquí para mostrar
// el costo en curso y validar antes de enviar.

export type DayRule = 'natural' | '24h'
export type RateMode = 'per_day' | 'per_stay'

export const DAY_RULE_OPTIONS: Array<{ value: DayRule; title: string; hint: string }> = [
  {
    value: 'natural',
    title: 'Día natural',
    hint: 'Cada día del calendario que toca la estancia cuenta como un día (cambia a medianoche).',
  },
  {
    value: '24h',
    title: '24 horas',
    hint: 'Bloques de 24 horas desde el ingreso, redondeando hacia arriba.',
  },
]

export const RATE_MODE_OPTIONS: Array<{ value: RateMode; title: string }> = [
  { value: 'per_day', title: 'Por día' },
  { value: 'per_stay', title: 'Por estancia (monto único)' },
]

// ── Días y costo ─────────────────────────────────────────────────────────────

/** Fecha local `yyyy-MM-dd` de un instante en la zona IANA dada (sin librerías: Intl). */
function localDate(instant: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant)
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')}`
}

/** Diferencia en días entre dos fechas `yyyy-MM-dd` (sin horas ni zonas). */
function dayDiff(from: string, to: string): number {
  const a = Date.UTC(...(from.split('-').map(Number) as [number, number, number]))
  const b = Date.UTC(...(to.split('-').map(Number) as [number, number, number]))
  return Math.round((b - a) / 86_400_000)
}

/**
 * Días de una estancia. 'natural': cada día calendario tocado (en la zona de la sucursal)
 * cuenta; ingresar el lunes y salir el lunes es 1, el martes es 2. '24h': bloques de 24 horas
 * desde el ingreso, hacia arriba. Mínimo 1 en ambas. Es `app.hospital_stay_days()` de la base.
 */
export function stayDays(
  admittedAt: Date,
  endAt: Date,
  rule: DayRule,
  timezone: string,
): number {
  if (rule === '24h') {
    const hours = (endAt.getTime() - admittedAt.getTime()) / 3_600_000
    return Math.max(1, Math.ceil(hours / 24))
  }
  return Math.max(
    1,
    dayDiff(localDate(admittedAt, timezone), localDate(endAt, timezone)) + 1,
  )
}

export interface StayRate {
  rateMode: RateMode
  rateCents: number
  dayRule: DayRule
}

/** Días y importe (con IVA incluido, en centavos enteros, §8.2) de la estancia hasta `endAt`. */
export function stayCharge(
  stay: StayRate,
  admittedAt: Date,
  endAt: Date,
  timezone: string,
): { days: number; amountCents: number } {
  if (stay.rateMode === 'per_stay') return { days: 1, amountCents: stay.rateCents }
  const days = stayDays(admittedAt, endAt, stay.dayRule, timezone)
  return { days, amountCents: stay.rateCents * days }
}

/**
 * Tarifa sugerida al ingresar: la del espacio y, si no tiene, la del negocio. Nulo si no hay
 * ninguna (se captura a mano).
 */
export function suggestedRate(
  mode: RateMode,
  space: { daily_rate_cents: number | null; stay_rate_cents: number | null } | null,
  settings: {
    default_daily_rate_cents: number | null
    default_stay_rate_cents: number | null
  } | null,
): number | null {
  if (mode === 'per_day') {
    return space?.daily_rate_cents ?? settings?.default_daily_rate_cents ?? null
  }
  return space?.stay_rate_cents ?? settings?.default_stay_rate_cents ?? null
}

// ── Bitácora ─────────────────────────────────────────────────────────────────

export const MUCOUS_OPTIONS = [
  { value: 'pink', title: 'Rosas' },
  { value: 'pale', title: 'Pálidas' },
  { value: 'yellow', title: 'Amarillas' },
  { value: 'cyanotic', title: 'Cianóticas (azuladas)' },
  { value: 'red', title: 'Rojas' },
] as const

export const MOOD_OPTIONS = [
  { value: 'alert', title: 'Alerta' },
  { value: 'calm', title: 'Tranquilo' },
  { value: 'depressed', title: 'Decaído' },
  { value: 'agitated', title: 'Agitado' },
  { value: 'sleeping', title: 'Dormido' },
] as const

export const ELIMINATION_OPTIONS = [
  { value: 'both', title: 'Orinó y defecó' },
  { value: 'urine_only', title: 'Solo orinó' },
  { value: 'stool_only', title: 'Solo defecó' },
  { value: 'none', title: 'Ninguna' },
  { value: 'diarrhea', title: 'Diarrea' },
] as const

type Option = { value: string; title: string }

function labelOf(options: readonly Option[], value: string | null): string | null {
  if (value === null) return null
  return options.find((o) => o.value === value)?.title ?? null
}

export const mucousLabel = (v: string | null) => labelOf(MUCOUS_OPTIONS, v)
export const moodLabel = (v: string | null) => labelOf(MOOD_OPTIONS, v)
export const eliminationLabel = (v: string | null) => labelOf(ELIMINATION_OPTIONS, v)

/** 385 → "38.5 °C" (la temperatura se guarda en décimas de grado, §8.2). */
export function formatTemperature(deciC: number | null): string | null {
  return deciC === null ? null : `${(deciC / 10).toFixed(1)} °C`
}

/** 12400 → "12.4 kg". */
export function formatWeight(grams: number | null): string | null {
  return grams === null ? null : `${(grams / 1000).toFixed(1)} kg`
}

export interface NoteInput {
  content: string
  temperatureC: number | null
  weightKg: number | null
  heartRateBpm: number | null
  mucousColor: string | null
  mood: string | null
  elimination: string | null
}

/** Pasa lo capturado (grados, kilos) a lo que guarda la base (décimas de grado, gramos). */
export function noteToStored(input: NoteInput) {
  return {
    content: input.content.trim() === '' ? null : input.content.trim(),
    temperature_deci_c:
      input.temperatureC === null ? null : Math.round(input.temperatureC * 10),
    weight_grams: input.weightKg === null ? null : Math.round(input.weightKg * 1000),
    heart_rate_bpm: input.heartRateBpm,
    mucous_color: input.mucousColor,
    mood: input.mood,
    elimination: input.elimination,
  }
}

/** Mensaje si la nota no se puede guardar (rangos que la base también exige); si no, `null`. */
export function noteProblem(input: NoteInput): string | null {
  const stored = noteToStored(input)
  const empty =
    stored.content === null &&
    stored.temperature_deci_c === null &&
    stored.weight_grams === null &&
    stored.heart_rate_bpm === null &&
    stored.mucous_color === null &&
    stored.mood === null &&
    stored.elimination === null
  if (empty) return 'Escribe algo en la nota o captura al menos un dato.'
  if (
    stored.temperature_deci_c !== null &&
    (stored.temperature_deci_c < 250 || stored.temperature_deci_c > 480)
  ) {
    return 'La temperatura debe estar entre 25.0 y 48.0 °C.'
  }
  if (stored.weight_grams !== null && stored.weight_grams <= 0)
    return 'El peso debe ser mayor a 0.'
  if (
    stored.heart_rate_bpm !== null &&
    (!Number.isInteger(stored.heart_rate_bpm) ||
      stored.heart_rate_bpm < 10 ||
      stored.heart_rate_bpm > 400)
  ) {
    return 'La frecuencia cardiaca debe ser un entero entre 10 y 400.'
  }
  return null
}
