// Validaciones de formato para datos mexicanos (CLAUDE.md §5.2, §8.4).
// Son funciones puras: reciben un texto, regresan true/false. No hablan
// con la base ni con la UI — por eso viven en lib/ y no en services/ ni
// en un componente (CLAUDE.md §4, "la regla de capas").

/**
 * RFC (Registro Federal de Contribuyentes), persona física o moral.
 *
 * Estructura de un RFC (lo que valida esta función):
 * - Persona física (una persona): 4 letras del nombre + 6 dígitos de la
 *   fecha de nacimiento (AAMMDD) + 3 caracteres de "homoclave" — 13 en
 *   total. Ejemplo: `RUCS850312AB1`.
 * - Persona moral (una empresa): 3 letras de la razón social + los
 *   mismos 6 dígitos de fecha (de constitución, en este caso) + 3 de
 *   homoclave — 12 en total. Ejemplo: `PFE120515AB1`.
 *
 * La "homoclave" son los últimos 3 caracteres — el SAT los calcula con
 * un algoritmo propio (suma ponderada + dígito verificador) para que dos
 * personas con el mismo nombre y fecha no choquen. Esta función NO
 * reproduce ese algoritmo — sería mucho código para un demo, y ni
 * siquiera el SAT lo expone públicamente sin más contexto. Lo que sí
 * valida es la FORMA: que la homoclave tenga la longitud y el tipo de
 * caracteres correctos. Es suficiente para atrapar errores de captura
 * (typos, pegar el RFC incompleto), que es el 99% de los casos reales en
 * un formulario — no para certificar que el RFC existe de verdad ante el
 * SAT.
 */
export function isValidRFC(value: string): boolean {
  const normalized = value.trim().toUpperCase()

  const personaFisica = /^[A-ZÑ&]{4}\d{6}[A-Z0-9]{3}$/
  const personaMoral = /^[A-ZÑ&]{3}\d{6}[A-Z0-9]{3}$/

  return personaFisica.test(normalized) || personaMoral.test(normalized)
}

/**
 * Teléfono mexicano: 10 dígitos, sin importar cómo los haya separado
 * quien los escribió (espacios, guiones, paréntesis) — se ignoran esos
 * caracteres antes de contar. No valida lada ni que el número exista de
 * verdad, solo la forma.
 */
export function isValidPhone(value: string): boolean {
  const digitsOnly = value.replace(/[\s()-]/g, '')
  return /^\d{10}$/.test(digitsOnly)
}

/**
 * Código postal mexicano: 5 dígitos.
 */
export function isValidPostalCode(value: string): boolean {
  return /^\d{5}$/.test(value.trim())
}

/**
 * Correo electrónico: solo la FORMA (algo@dominio.ext, sin espacios) — no
 * intenta reproducir el estándar completo de RFC 5322, que acepta cosas
 * que ningún formulario real debería dejar pasar. Que el buzón exista de
 * verdad lo confirma la invitación misma: si rebota, no llega.
 */
export function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
}

/**
 * CURP (Clave Única de Registro de Población), 18 caracteres con esta
 * forma: 4 letras (inicial de apellido paterno, primera vocal interna del
 * apellido paterno, inicial de apellido materno, inicial del nombre) + 6
 * dígitos de fecha de nacimiento (AAMMDD) + sexo ('H' u 'M') + 2 letras de
 * entidad de nacimiento + 3 consonantes internas + 1 diferenciador
 * (dígito si nació antes del año 2000, letra si nació después) + 1 dígito
 * verificador.
 *
 * Mismo criterio que isValidRFC: valida la FORMA (longitud, tipo de
 * carácter en cada posición, que el mes/día de la fecha existan), no el
 * dígito verificador real de RENAPO — reproducirlo es más código del que
 * vale la pena para un demo, y atrapa igual el 99% de los errores de
 * captura.
 */
export function isValidCURP(value: string): boolean {
  const normalized = value.trim().toUpperCase()

  return /^[A-Z][AEIOU][A-Z]{2}\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])[HM][A-Z]{2}[B-DF-HJ-NP-TV-Z]{3}[A-Z\d]\d$/.test(
    normalized,
  )
}

// ---------------------------------------------------------------------------
// Cambio de contraseña propia
// ---------------------------------------------------------------------------

/**
 * Largo mínimo de una contraseña nueva. Es la regla de la UI: el servidor
 * tiene la suya (`minimum_password_length` en supabase/config.toml, 6 en
 * local) y puede ser más laxa o más estricta según el proyecto; validar aquí
 * evita mandar al servidor algo que ya sabemos que no queremos, y da el
 * mensaje en español en vez del error en inglés de Supabase.
 */
export const MIN_PASSWORD_LENGTH = 8

export interface PasswordChangeInput {
  current: string
  next: string
  confirm: string
}

export type PasswordChangeField = 'current' | 'next' | 'confirm'

/**
 * Problemas del formulario "Cambiar contraseña", por campo. Objeto vacío =
 * todo bien. Función pura: no toca la red ni compara contra la contraseña
 * real (eso lo hace el servidor al verificar la actual).
 *
 * `next` puede repetir a `current` solo si ambos están vacíos; en ese caso el
 * error que importa es el de "falta la actual", no el de "es igual".
 */
export function passwordChangeProblems(
  input: PasswordChangeInput,
): Partial<Record<PasswordChangeField, string>> {
  const problems: Partial<Record<PasswordChangeField, string>> = {}

  if (input.current === '') problems.current = 'Escribe tu contraseña actual.'

  if (input.next.length < MIN_PASSWORD_LENGTH) {
    problems.next = `La contraseña nueva debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`
  } else if (input.next === input.current) {
    problems.next = 'La contraseña nueva debe ser distinta de la actual.'
  }

  if (input.confirm !== input.next) problems.confirm = 'Las contraseñas no coinciden.'

  return problems
}

export interface PasswordResetInput {
  next: string
  confirm: string
}

export type PasswordResetField = 'next' | 'confirm'

/**
 * Problemas del formulario "Elige tu nueva contraseña" (recuperación por
 * correo). Igual que `passwordChangeProblems` pero SIN contraseña actual:
 * quien olvidó la contraseña no la tiene, y entró con el enlace del correo.
 */
export function passwordResetProblems(
  input: PasswordResetInput,
): Partial<Record<PasswordResetField, string>> {
  const problems: Partial<Record<PasswordResetField, string>> = {}

  if (input.next.length < MIN_PASSWORD_LENGTH) {
    problems.next = `La contraseña nueva debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`
  }
  if (input.confirm !== input.next) problems.confirm = 'Las contraseñas no coinciden.'

  return problems
}

// ---------------------------------------------------------------------------
// Claves del SAT por servicio (CFDI 4.0, fase 11 tarea 11.2)
// ---------------------------------------------------------------------------

/**
 * ClaveProdServ (c_ClaveProdServ): identifica QUÉ se factura. Son 8 dígitos
 * (segmento, familia, clase, producto). Ejemplo: `70122000` = "Salud animal".
 *
 * Igual que RFC y CURP: valida la FORMA, no que la clave exista en el
 * catálogo del SAT (son más de 50 mil y cambian; que sea la correcta para el
 * negocio lo decide su contador).
 */
export function isValidSatProductCode(value: string): boolean {
  return /^\d{8}$/.test(value.trim())
}

/**
 * ClaveUnidad (c_ClaveUnidad): en qué se mide el concepto. Son 2 o 3
 * caracteres alfanuméricos en mayúsculas: `E48` (unidad de servicio), `H87`
 * (pieza), `KGM` (kilogramo), `XBX` (caja), `EA` (elemento, 2 caracteres).
 */
export function isValidSatUnitCode(value: string): boolean {
  return /^[A-Z0-9]{2,3}$/.test(value.trim().toUpperCase())
}

// --- Datos fiscales de quien recibe la factura (fase 13, tarea 13.5) ---

export interface FiscalReceiverInput {
  rfc: string
  legalName: string
  taxRegimeCode: string
  cfdiUse: string
  postalCode: string
}

/**
 * Lo que falta o está mal para poder facturar a alguien, en español y listo para
 * mostrarse. Vacío = los datos alcanzan.
 *
 * Revisa la FORMA, no que el SAT los acepte: el régimen son 3 dígitos (601, 612…) y el
 * uso de CFDI una o dos letras y dos dígitos (G03, D01, CP01…). Un dato con forma
 * correcta pero inexistente lo rechaza el PAC al timbrar, no esta función.
 */
export function fiscalReceiverProblems(data: FiscalReceiverInput): string[] {
  const problems: string[] = []
  if (!isValidRFC(data.rfc)) problems.push('El RFC no es válido.')
  if (!data.legalName.trim()) problems.push('Falta la razón social.')
  if (!/^\d{3}$/.test(data.taxRegimeCode.trim())) {
    problems.push('El régimen fiscal debe ser un código de 3 dígitos (por ejemplo 612).')
  }
  if (!/^[A-Z]{1,2}\d{2}$/.test(data.cfdiUse.trim().toUpperCase())) {
    problems.push('El uso de CFDI debe ser un código como G03.')
  }
  if (!isValidPostalCode(data.postalCode)) {
    problems.push('El código postal fiscal debe tener 5 dígitos.')
  }
  return problems
}
