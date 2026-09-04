import { describe, expect, it } from 'vitest'

import { isValidPhone, isValidPostalCode, isValidRFC } from './validation'

describe('isValidRFC', () => {
  it('acepta un RFC de persona física bien formado', () => {
    // Caso base: 4 letras + 6 dígitos de fecha + 3 de homoclave = 13
    // caracteres. Si esto falla, ningún cliente persona física podría
    // guardar su RFC para facturar (CLAUDE.md §8.4).
    expect(isValidRFC('RUCS850312AB1')).toBe(true)
  })

  it('acepta un RFC de persona moral bien formado', () => {
    // 3 letras + 6 dígitos + 3 de homoclave = 12 caracteres — un
    // carácter menos que persona física, es la diferencia real entre
    // ambos formatos. Se reusa el RFC ficticio de "Patitas Felices"
    // (supabase/seed.sql) para no inventar uno nuevo.
    expect(isValidRFC('PFE120515AB1')).toBe(true)
  })

  it('rechaza una homoclave con longitud incorrecta', () => {
    // La homoclave (los últimos 3 caracteres) le falta uno — un error de
    // captura común (el usuario pegó el RFC recortado). Sin esta
    // validación, un RFC incompleto se guardaría y solo se descubriría
    // el problema hasta que se intentara facturar de verdad.
    expect(isValidRFC('RUCS850312AB')).toBe(false)
  })

  it('rechaza cadena vacía', () => {
    // Borde obvio pero real: un campo opcional que se deja vacío no debe
    // "colarse" como RFC válido solo porque la regex, mal escrita, podría
    // aceptar longitud 0 en algún caso raro.
    expect(isValidRFC('')).toBe(false)
  })

  it('acepta en minúsculas (se normaliza antes de validar)', () => {
    // Nadie captura un RFC pensando en mayúsculas. Si la función no
    // normalizara internamente, cada formulario tendría que acordarse de
    // hacer .toUpperCase() antes de llamarla — más fácil que la función
    // lo garantice una sola vez.
    expect(isValidRFC('rucs850312ab1')).toBe(true)
  })

  it('ignora espacios al inicio o al final', () => {
    // Un RFC pegado desde un PDF o un Excel casi siempre trae un espacio
    // de sobra. Rechazarlo por eso sería un falso negativo molesto y
    // fácil de evitar con un trim().
    expect(isValidRFC('  RUCS850312AB1  ')).toBe(true)
  })

  it('rechaza un espacio EN MEDIO del RFC', () => {
    // Distinto del caso anterior: un espacio adentro no es un accidente
    // de copiar/pegar que se pueda limpiar solo — es una señal real de
    // que el dato está mal, y sí debe rechazarse.
    expect(isValidRFC('RUCS 850312AB1')).toBe(false)
  })
})

describe('isValidPhone', () => {
  it('acepta 10 dígitos seguidos', () => {
    expect(isValidPhone('5512345678')).toBe(true)
  })

  it('acepta el mismo número con espacios o guiones, formato humano', () => {
    // Nadie captura un teléfono como un bloque de 10 dígitos seguidos —
    // lo natural es algo como "55 1234 5678". La validación debe tolerar
    // cómo la gente escribe de verdad, no solo el formato "limpio".
    expect(isValidPhone('55 1234 5678')).toBe(true)
    expect(isValidPhone('55-1234-5678')).toBe(true)
  })

  it('rechaza menos de 10 dígitos', () => {
    // Un teléfono de México siempre lleva los 10 dígitos (lada +
    // número) — 9 o menos es casi siempre un error de captura, no un
    // número real distinto.
    expect(isValidPhone('551234567')).toBe(false)
  })

  it('rechaza texto que no son dígitos', () => {
    expect(isValidPhone('llamar-por-favor')).toBe(false)
  })
})

describe('isValidPostalCode', () => {
  it('acepta 5 dígitos', () => {
    expect(isValidPostalCode('03100')).toBe(true)
  })

  it('rechaza menos de 5 dígitos', () => {
    // Un código postal mexicano con menos de 5 dígitos casi siempre es
    // que se perdió un cero a la izquierda (p. ej. "3100" en vez de
    // "03100") — un bug real de capturar el CP como número en vez de
    // texto en algún punto de la cadena.
    expect(isValidPostalCode('3100')).toBe(false)
  })

  it('rechaza letras', () => {
    expect(isValidPostalCode('0310A')).toBe(false)
  })
})
