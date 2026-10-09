// Pruebas de las iniciales del avatar.
import { describe, expect, it } from 'vitest'

import { initialsOf } from './initials'

describe('initialsOf', () => {
  // Qué prueba: el caso normal. Con varios apellidos solo cuentan nombre y primer
  // apellido; si tomara las tres letras, el avatar redondo se desbordaría.
  it('usa la inicial del nombre y la del primer apellido', () => {
    expect(initialsOf('Sofía Ramírez Torres')).toBe('SR')
  })

  // Qué prueba: un nombre de una sola palabra, o espacios de más al principio, al
  // final o entre palabras (datos capturados a mano). No debe dar vacío ni "undefined".
  it('tolera un solo nombre y espacios de más', () => {
    expect(initialsOf('Marcos')).toBe('M')
    expect(initialsOf('  ana   lópez ')).toBe('AL')
  })

  // Qué prueba: que una inicial con acento queda completa y en mayúscula. Con
  // `name[0]` en una letra especial, el avatar mostraría un carácter roto.
  it('respeta acentos, eñes y minúsculas', () => {
    expect(initialsOf('émilie ñandú')).toBe('ÉÑ')
  })

  // Qué prueba: que sin nombre (perfil aún sin cargar o vacío) devuelve un signo en
  // lugar de truenar; el avatar siempre tiene algo que mostrar.
  it('devuelve "?" si no hay nombre', () => {
    expect(initialsOf('')).toBe('?')
    expect(initialsOf('   ')).toBe('?')
    expect(initialsOf(null)).toBe('?')
    expect(initialsOf(undefined)).toBe('?')
  })

  // Qué prueba: el respaldo con correo (cuando el perfil no trae nombre se pasa el
  // correo). Una sola "palabra", así que da una letra.
  it('con un correo da la primera letra', () => {
    expect(initialsOf('ana@correo.mx')).toBe('A')
  })
})
