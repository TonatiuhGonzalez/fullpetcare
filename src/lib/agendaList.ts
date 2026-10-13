// Lista de la agenda para celular (fase 26, PLAN.md D29): las mismas citas que pinta el
// calendario, pero ordenadas por hora y agrupadas por día. Funciones puras: reciben los
// bloques (`CalendarBlock`, cuyas horas ya son "hora de pared" de la sucursal sin zona,
// `YYYY-MM-DDTHH:mm:ss`) y no saben nada de Vue ni de zonas horarias.
import type { CalendarBlock } from './calendarGrid'

export interface DayGroup {
  /** 'YYYY-MM-DD' */
  date: string
  blocks: CalendarBlock[]
}

/**
 * Agrupa por día y ordena por hora de inicio (y, a igual hora, por id para que el orden no
 * cambie entre recargas). Los días sin citas no aparecen: en una lista un día vacío es ruido.
 */
export function groupBlocksByDay(blocks: CalendarBlock[]): DayGroup[] {
  const byDate = new Map<string, CalendarBlock[]>()
  for (const block of blocks) {
    const date = block.start.slice(0, 10)
    const list = byDate.get(date)
    if (list) list.push(block)
    else byDate.set(date, [block])
  }
  return [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, list]) => ({
      date,
      blocks: [...list].sort(
        (x, y) => x.start.localeCompare(y.start) || x.id.localeCompare(y.id),
      ),
    }))
}

/** 'HH:mm' de un instante "de pared" sin zona. */
export function timeOf(naiveIso: string): string {
  return naiveIso.slice(11, 16)
}

/** '10:00 – 11:30' */
export function timeRange(block: Pick<CalendarBlock, 'start' | 'end'>): string {
  return `${timeOf(block.start)} – ${timeOf(block.end)}`
}
