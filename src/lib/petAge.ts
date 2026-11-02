// Edad de una mascota y su fecha de nacimiento aproximada (fase 27, PLAN.md D30 punto 2).
//
// El dueño suele decir "tiene 3 años" y no sabe el día. La pantalla convierte esa edad en
// una FECHA PROPUESTA que el veterinario puede ajustar, y la guarda marcada como estimada
// (`pets.birth_date_is_estimated`). Todo es aritmética de fechas sin hora ni zona (una
// fecha de nacimiento no tiene zona, CLAUDE.md §8.3): "hoy" llega como `yyyy-MM-dd` desde
// quien llama (`branchToday`), no se lee del reloj aquí, así las pruebas no dependen del día.

/** Tope razonable: ninguna mascota doméstica pasa de 50 años; más es un error de captura. */
export const MAX_PET_YEARS = 50

export interface PetAge {
  years: number
  months: number
}

function parse(date: string): { y: number; m: number; d: number } {
  const [y, m, d] = date.split('-').map(Number)
  return { y, m, d }
}

function pad(n: number, size = 2): string {
  return String(n).padStart(size, '0')
}

/** Días del mes `m` (1 a 12) del año `y`; febrero respeta los años bisiestos. */
function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}

/** Mensaje si los años o los meses no sirven; `null` si están bien (vacío cuenta como 0). */
export function ageProblem(years: unknown, months: unknown): string | null {
  const y = years === '' || years == null ? 0 : Number(years)
  const m = months === '' || months == null ? 0 : Number(months)
  if (!Number.isInteger(y) || !Number.isInteger(m) || y < 0 || m < 0) {
    return 'Escribe años y meses como números enteros, de 0 en adelante.'
  }
  if (m > 11) return 'Los meses van de 0 a 11; los años completos van en "años".'
  if (y > MAX_PET_YEARS) return `La edad no puede pasar de ${MAX_PET_YEARS} años.`
  if (y === 0 && m === 0) return 'Indica al menos un mes de edad.'
  return null
}

/**
 * Fecha de nacimiento aproximada para una edad de `years` años y `months` meses a `today`.
 * Conserva el día del mes de hoy; si ese día no existe en el mes resultante (31 de marzo
 * menos un mes) usa el último día de ese mes. Es una propuesta, no un dato del documento.
 */
export function birthDateFromAge(today: string, years: number, months: number): string {
  const { y, m, d } = parse(today)
  const total = y * 12 + (m - 1) - (years * 12 + months)
  const targetYear = Math.floor(total / 12)
  const targetMonth = (total % 12) + 1
  const day = Math.min(d, daysInMonth(targetYear, targetMonth))
  return `${pad(targetYear, 4)}-${pad(targetMonth)}-${pad(day)}`
}

/**
 * Años y meses cumplidos entre `birthDate` y `today`. Nulo si la fecha es futura (un error
 * de captura que la pantalla debe mostrar, no esconder).
 */
export function ageFromBirthDate(birthDate: string, today: string): PetAge | null {
  if (birthDate > today) return null
  const b = parse(birthDate)
  const t = parse(today)
  let total = (t.y - b.y) * 12 + (t.m - b.m)
  // Si todavía no llega el día del mes del nacimiento, ese mes no está cumplido.
  if (t.d < b.d) total -= 1
  return { years: Math.floor(total / 12), months: total % 12 }
}

/** "3 años 2 meses", "1 año", "8 meses" o "Menos de 1 mes". */
export function formatAge(age: PetAge): string {
  const parts: string[] = []
  if (age.years > 0) parts.push(age.years === 1 ? '1 año' : `${age.years} años`)
  if (age.months > 0) parts.push(age.months === 1 ? '1 mes' : `${age.months} meses`)
  return parts.length > 0 ? parts.join(' ') : 'Menos de 1 mes'
}
