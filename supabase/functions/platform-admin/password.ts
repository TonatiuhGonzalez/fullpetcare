// Generador de contraseñas temporales para la Edge Function platform-admin
// (fase 10). Función PURA en su propio archivo, sin `Deno.*` ni imports: así
// se prueba con Vitest igual que cualquier función de `lib/` (ver
// supabase/tests/temporary-password.spec.ts), en vez de quedar enterrada
// dentro del handler HTTP.
//
// Vive aquí y no en src/lib/ porque la contraseña se genera SIEMPRE en el
// servidor (la Edge Function), nunca en el navegador: el frontend solo la
// recibe para mostrársela una vez al superadmin.
//
// =============================================================================
// Decisiones (y por qué)
// =============================================================================
// - Aleatoriedad criptográfica (`crypto.getRandomValues`), NO Math.random():
//   Math.random() es predecible; una contraseña de acceso no puede serlo.
// - Alfabeto sin caracteres ambiguos (sin 0/O, 1/l/I): el superadmin se la
//   va a dictar o pegar al dueño por WhatsApp o teléfono, y "¿es cero u o?"
//   es el error más común al transcribirla.
// - Solo letras y dígitos, sin símbolos: los símbolos se rompen al copiar
//   entre apps (comillas "inteligentes", guiones largos). 14 caracteres de
//   un alfabeto de 57 son ≈ 81 bits de entropía: de sobra para una
//   contraseña temporal que el dueño debe cambiar.
// - Siempre al menos una mayúscula, una minúscula y un dígito: cumple
//   cualquier política de contraseñas razonable que se active después.

const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ' // sin I ni O
const LOWER = 'abcdefghijkmnopqrstuvwxyz' // sin l
const DIGITS = '23456789' // sin 0 ni 1
const ALPHABET = UPPER + LOWER + DIGITS

export const TEMPORARY_PASSWORD_LENGTH = 14

/** Fuente de aleatoriedad; se puede inyectar solo para probar casos borde. */
export type RandomSource = (array: Uint32Array) => Uint32Array

const defaultSource: RandomSource = (array) => crypto.getRandomValues(array)

/**
 * Entero uniforme en [0, max) por muestreo con rechazo.
 *
 * Por qué no `valor % max`: 2^32 no es múltiplo de `max`, así que los
 * primeros valores del rango saldrían un poco más seguido que los últimos
 * ("sesgo de módulo"). Con muestreo con rechazo se descartan los valores
 * de la "cola" que causaría ese sesgo y se vuelve a tirar.
 */
function randomIndex(max: number, source: RandomSource): number {
  const limit = Math.floor(0x1_0000_0000 / max) * max
  const buffer = new Uint32Array(1)
  for (;;) {
    const value = source(buffer)[0]
    if (value < limit) return value % max
  }
}

function pick(chars: string, source: RandomSource): string {
  return chars[randomIndex(chars.length, source)]
}

export function generateTemporaryPassword(
  length: number = TEMPORARY_PASSWORD_LENGTH,
  source: RandomSource = defaultSource,
): string {
  if (length < 3) {
    throw new Error('La contraseña necesita al menos 3 caracteres (una de cada clase).')
  }

  // Una de cada clase garantizada, el resto del alfabeto completo...
  const chars = [pick(UPPER, source), pick(LOWER, source), pick(DIGITS, source)]
  while (chars.length < length) chars.push(pick(ALPHABET, source))

  // ...y se baraja (Fisher-Yates) para que las tres garantizadas no queden
  // siempre en las primeras posiciones, que es un patrón predecible.
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomIndex(i + 1, source)
    ;[chars[i], chars[j]] = [chars[j], chars[i]]
  }

  return chars.join('')
}
