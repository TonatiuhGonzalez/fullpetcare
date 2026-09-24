// Prueba generateTemporaryPassword() (supabase/functions/platform-admin/
// password.ts). No toca la base de datos: es una función pura, y vive junto
// a los tests de BD solo porque el código que prueba está en supabase/.
//
// Qué se rompería en producción si fallara: esta contraseña es LA credencial
// con la que un dueño entra por primera vez. Si fuera predecible, cualquiera
// que sepa el correo de un dueño nuevo entraría antes que él; si tuviera
// caracteres ambiguos, el superadmin la dictaría mal por teléfono.
import { describe, expect, it } from 'vitest'

import {
  generateTemporaryPassword,
  TEMPORARY_PASSWORD_LENGTH,
  type RandomSource,
} from '../functions/platform-admin/password'

// Una "fuente de aleatoriedad" falsa que devuelve valores fijos: para probar
// casos borde sin depender del azar. Es un arreglo, no un mock elaborado.
function fixedSource(values: number[]): RandomSource {
  let i = 0
  return (array) => {
    array[0] = values[i % values.length]
    i++
    return array
  }
}

describe('generateTemporaryPassword', () => {
  it('tiene la longitud por default (14) y respeta una longitud pedida', () => {
    // Si la longitud se ignorara, una contraseña de "8" podría salir de 3.
    expect(generateTemporaryPassword()).toHaveLength(TEMPORARY_PASSWORD_LENGTH)
    expect(generateTemporaryPassword(20)).toHaveLength(20)
  })

  it('nunca contiene caracteres ambiguos (0, O, 1, l, I) ni símbolos', () => {
    // El superadmin se la dicta al dueño por teléfono o WhatsApp: "¿es cero
    // o letra o?" es el error de transcripción más común. Se prueba con
    // muchas contraseñas porque un solo intento podría pasar por suerte.
    for (let i = 0; i < 2000; i++) {
      expect(generateTemporaryPassword()).toMatch(/^[A-HJ-NP-Za-km-z2-9]+$/)
    }
  })

  it('siempre tiene al menos una mayúscula, una minúscula y un dígito', () => {
    // Cualquier política de contraseñas razonable que se active después
    // (Supabase Auth permite exigirlo) rechazaría una contraseña sin alguna
    // de las tres clases, y el alta del dueño fallaría al azar. Con longitud
    // mínima (3) es donde más fácil sería fallar.
    for (let i = 0; i < 2000; i++) {
      const p = generateTemporaryPassword(i % 2 === 0 ? 3 : TEMPORARY_PASSWORD_LENGTH)
      expect(p).toMatch(/[A-Z]/)
      expect(p).toMatch(/[a-z]/)
      expect(p).toMatch(/[0-9]/)
    }
  })

  it('rechaza una longitud menor a 3 (no cabrían las tres clases)', () => {
    // Mejor un error claro que una contraseña que no cumple lo prometido.
    expect(() => generateTemporaryPassword(2)).toThrow(/al menos 3/)
  })

  it('dos contraseñas seguidas no se repiten', () => {
    // Detecta el error clásico de un generador sin aleatoriedad real (una
    // semilla fija, o un valor cacheado): todas las cuentas nuevas
    // compartirían la misma contraseña temporal.
    const seen = new Set<string>()
    for (let i = 0; i < 1000; i++) seen.add(generateTemporaryPassword())
    expect(seen.size).toBe(1000)
  })

  it('no favorece los primeros caracteres del alfabeto (sin sesgo de módulo)', () => {
    // Con `valor % 57` los caracteres del principio del alfabeto salen
    // ligeramente más seguido. Aquí se fuerza el peor caso: una fuente que
    // solo devuelve valores en la "cola" que causaría el sesgo
    // (>= 2^32 - (2^32 % 57)). El generador debe RECHAZARLOS y volver a
    // tirar, en vez de convertirlos en un carácter.
    const tail = 0xffffffff // último valor posible; cae en la cola
    // Alterna: un valor de la cola (debe descartarse) y uno válido (0 → 'A').
    const source = fixedSource([tail, 0])
    // Con la fuente alterna, en las mayúsculas (24 letras) y minúsculas (25)
    // el valor de la cola se descarta y el siguiente (0) da el índice 0:
    // 'A' y 'a'. Si NO se rechazara, saldrían 'R' y 'v' (0xffffffff % 24 y
    // % 25). Los dígitos (8) no se prueban aquí: 2^32 es múltiplo de 8, así
    // que ahí no existe sesgo y ningún valor se descarta.
    const p = generateTemporaryPassword(3, source)
    expect(p).toContain('A')
    expect(p).toContain('a')
    expect(p).not.toContain('R')
    expect(p).not.toContain('v')
  })
})
