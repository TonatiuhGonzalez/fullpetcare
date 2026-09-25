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
