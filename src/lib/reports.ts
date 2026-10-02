// Lógica pura de la pantalla de Reportes (fase 12, tarea 12.12 / HMH Four #2078):
// periodos, escala de las barras y exportación a CSV. Sin red ni Vue; por eso vive
// en lib/ y tiene tests. Las fechas son TEXTO 'YYYY-MM-DD' (días calendario de la
// sucursal, CLAUDE.md §8.3): el cálculo de "hoy" en la zona correcta lo hace quien
// llama (branchToday) y aquí solo se hace aritmética de calendario.

export type PeriodPreset = 'today' | 'week' | 'month' | 'last_month' | 'range'

export const PERIOD_LABELS: Record<PeriodPreset, string> = {
  today: 'Hoy',
  week: 'Esta semana',
  month: 'Este mes',
  last_month: 'Mes pasado',
  range: 'Rango de fechas',
}

export interface DateRange {
  from: string
  to: string
}

function parse(date: string): Date {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}

function format(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function addDays(date: string, days: number): string {
  const d = parse(date)
  d.setUTCDate(d.getUTCDate() + days)
  return format(d)
}

/**
 * El rango de fechas de un periodo, a partir del día de HOY en la sucursal.
 * - `week`: del lunes de esta semana (la semana mexicana empieza en lunes) a hoy.
 * - `month`: del día 1 de este mes a hoy.
 * - `last_month`: el mes anterior completo (maneja enero → diciembre y años bisiestos).
 * - `range` no se calcula aquí: lo captura la persona.
 */
export function periodRange(
  preset: Exclude<PeriodPreset, 'range'>,
  today: string,
): DateRange {
  switch (preset) {
    case 'today':
      return { from: today, to: today }
    case 'week': {
      const dayOfWeek = parse(today).getUTCDay() // 0 = domingo
      const sinceMonday = (dayOfWeek + 6) % 7
      return { from: addDays(today, -sinceMonday), to: today }
    }
    case 'month':
      return { from: `${today.slice(0, 7)}-01`, to: today }
    case 'last_month': {
      const firstOfThisMonth = parse(`${today.slice(0, 7)}-01`)
      const lastDayPrevious = new Date(firstOfThisMonth)
      lastDayPrevious.setUTCDate(0)
      const from = new Date(
        Date.UTC(lastDayPrevious.getUTCFullYear(), lastDayPrevious.getUTCMonth(), 1),
      )
      return { from: format(from), to: format(lastDayPrevious) }
    }
  }
}

/** "5 oct" / "5 de octubre de 2026" para un día 'YYYY-MM-DD' (sin zona horaria: es un día de calendario). */
export function formatDayLabel(day: string, long = false): string {
  return parse(day).toLocaleDateString('es-MX', {
    day: 'numeric',
    month: long ? 'long' : 'short',
    ...(long ? { year: 'numeric' } : {}),
    timeZone: 'UTC',
  })
}

/** Número de días del rango, ambos extremos incluidos. */
export function daysInRange(range: DateRange): number {
  return (
    Math.round((parse(range.to).getTime() - parse(range.from).getTime()) / 86_400_000) + 1
  )
}

/** Texto de por qué un rango escrito a mano no sirve, o null si es válido. */
export function rangeProblem(range: DateRange): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(range.from) || !/^\d{4}-\d{2}-\d{2}$/.test(range.to)) {
    return 'Elige las dos fechas del periodo.'
  }
  if (range.from > range.to) return 'La fecha inicial no puede ser posterior a la final.'
  // Mismo tope que la base (366 días): un periodo enorme solo tumba la consulta.
  if (daysInRange(range) > 366) return 'El periodo no puede ser mayor a un año.'
  return null
}

/**
 * Ancho (0–100) de cada barra respecto al valor más grande. Un valor mayor a 0
 * nunca se dibuja en 0 (se vería como "no vendió"): mínimo 2 %. Si todo es 0,
 * todas miden 0.
 */
export function barPercents(values: number[]): number[] {
  const max = Math.max(0, ...values)
  if (max === 0) return values.map(() => 0)
  return values.map((v) => (v <= 0 ? 0 : Math.max(2, Math.round((v / max) * 100))))
}

// -----------------------------------------------------------------------------
// CSV (para Excel)
// -----------------------------------------------------------------------------

/** Centavos como pesos con dos decimales y punto ("350.00"), sin "$" ni comas: Excel lo suma. */
export function centsToPesosText(cents: number): string {
  const sign = cents < 0 ? '-' : ''
  const abs = Math.abs(cents)
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`
}

/**
 * Una celda de CSV. Dos protecciones:
 *  1. Comillas, comas y saltos de línea se entrecomillan (RFC 4180).
 *  2. Una celda de TEXTO que empieza con = + - @ se prefija con una comilla simple,
 *     porque Excel la ejecutaría como fórmula ("inyección de fórmulas"): el nombre
 *     de un producto lo escribe una persona. Los números no se tocan, para que un
 *     negativo ("-5.00") siga siendo un número.
 */
export function csvCell(value: string | number): string {
  let text = typeof value === 'number' ? String(value) : value
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export interface CsvColumn<T> {
  header: string
  value: (row: T) => string | number
}

/**
 * El CSV completo. Empieza con BOM (﻿): sin él Excel abre el archivo como
 * ANSI y los acentos salen rotos ("CafÃ©"). Saltos de línea CRLF, el estándar.
 */
export function toCsv<T>(rows: T[], columns: CsvColumn<T>[]): string {
  const lines = [
    columns.map((c) => csvCell(c.header)).join(','),
    ...rows.map((row) => columns.map((c) => csvCell(c.value(row))).join(',')),
  ]
  return `﻿${lines.join('\r\n')}\r\n`
}
