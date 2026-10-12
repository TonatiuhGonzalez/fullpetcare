// Fechas futuras RELATIVAS para los tests que agendan por create_appointment().
//
// Desde C1.2 la base rechaza citas en el pasado y fuera del horario de la
// sucursal (semilla: lunes a viernes 09:00-18:00 en America/Mexico_City, que
// desde 2022 es UTC-6 todo el año). Una fecha fija como '2027-03-10' envejece:
// el día que pase, el test falla sin que nadie haya roto nada. Por eso se
// calcula "el próximo <día de la semana> a las HH:00 UTC" a partir de hoy.

/** Días de la semana como Date.getUTCDay(): 0 domingo ... 6 sábado. */
export const WEEKDAY = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
}

/**
 * El primer `weekday` que cae al menos `minDaysAhead` días en el futuro, a las
 * `hourUtc`:`minute` UTC. Con Ciudad de México (UTC-6), hourUtc 15 = 09:00
 * local, así que de 15 a 23 caen dentro del horario de la semilla.
 */
export function futureDateAtUtc(
  weekday: number,
  hourUtc: number,
  minute = 0,
  minDaysAhead = 21,
): Date {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + minDaysAhead)
  while (d.getUTCDay() !== weekday) d.setUTCDate(d.getUTCDate() + 1)
  d.setUTCHours(hourUtc, minute, 0, 0)
  return d
}
