import { describe, expect, it } from 'vitest'

import {
  isValidCURP,
  isValidEmail,
  isValidPhone,
  isValidPostalCode,
  isValidRFC,
  MIN_PASSWORD_LENGTH,
  passwordChangeProblems,
} from './validation'

describe('isValidEmail', () => {
  it('acepta un correo normal', () => {
    expect(isValidEmail('maria@patitasfelices.mx')).toBe(true)
  })

  it('rechaza un correo sin arroba ni dominio', () => {
    // El error de captura más común: olvidar el "@" o el ".mx". Sin
    // esta validación, la invitación se manda a un correo imposible y el
    // empleado nunca recibe nada, sin que quien lo dio de alta se entere.
    expect(isValidEmail('maria')).toBe(false)
    expect(isValidEmail('maria@patitas')).toBe(false)
  })

  it('rechaza espacios adentro del correo y cadena vacía', () => {
    expect(isValidEmail('maria @patitas.mx')).toBe(false)
    expect(isValidEmail('')).toBe(false)
  })

  it('ignora espacios al inicio o al final', () => {
    expect(isValidEmail('  maria@patitasfelices.mx  ')).toBe(true)
  })
})

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

describe('isValidCURP', () => {
  it('acepta una CURP bien formada', () => {
    // 4 letras + 6 dígitos de fecha + sexo + 2 letras de entidad + 3
    // consonantes + diferenciador + verificador = 18 caracteres. Si esto
    // falla, nadie puede guardar la CURP de un empleado (fase 9).
    expect(isValidCURP('GOMJ850312HDFRRL09')).toBe(true)
  })

  it('rechaza un mes de nacimiento que no existe', () => {
    // "13" como mes es justo el tipo de error de captura (transponer
    // día/mes) que esta validación existe para atrapar.
    expect(isValidCURP('GOMJ851312HDFRRL09')).toBe(false)
  })

  it('rechaza una letra de sexo distinta de H/M', () => {
    expect(isValidCURP('GOMJ850312XDFRRL09')).toBe(false)
  })

  it('rechaza longitud incorrecta', () => {
    // Un carácter de menos (la CURP se pegó recortada) es el error real
    // más común al capturar este dato a mano.
    expect(isValidCURP('GOMJ850312HDFRRL9')).toBe(false)
  })

  it('rechaza cadena vacía', () => {
    expect(isValidCURP('')).toBe(false)
  })

  it('acepta en minúsculas (se normaliza antes de validar)', () => {
    expect(isValidCURP('gomj850312hdfrrl09')).toBe(true)
  })

  it('ignora espacios al inicio o al final', () => {
    expect(isValidCURP('  GOMJ850312HDFRRL09  ')).toBe(true)
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

describe('passwordChangeProblems', () => {
  const valid = { current: 'Temporal123', next: 'MiNuevaClave9', confirm: 'MiNuevaClave9' }

  it('no reporta problemas cuando todo está bien', () => {
    // Camino feliz mínimo: si esto fallara, nadie podría cambiar su
    // contraseña aunque escribiera todo correcto.
    expect(passwordChangeProblems(valid)).toEqual({})
  })

  it('exige la contraseña actual', () => {
    // Sin pedirla, cualquiera que encuentre una sesión abierta en un equipo
    // compartido (la recepción de la veterinaria) podría cambiar la
    // contraseña del dueño y dejarlo fuera.
    expect(passwordChangeProblems({ ...valid, current: '' }).current).toBeDefined()
  })

  it('rechaza una contraseña nueva más corta que el mínimo', () => {
    // Borde: exactamente MIN-1 caracteres falla y exactamente MIN pasa.
    const short = 'a'.repeat(MIN_PASSWORD_LENGTH - 1)
    const exact = 'a'.repeat(MIN_PASSWORD_LENGTH)
    expect(passwordChangeProblems({ ...valid, next: short, confirm: short }).next).toBeDefined()
    expect(passwordChangeProblems({ ...valid, next: exact, confirm: exact }).next).toBeUndefined()
  })

  it('rechaza una contraseña nueva igual a la actual', () => {
    // Cambiar la contraseña por la misma no cambia nada, pero la persona
    // creería que ya se renovó. Con una temporal, sería dejar la que
    // el superadmin ya vio.
    const same = 'Temporal123'
    expect(passwordChangeProblems({ current: same, next: same, confirm: same }).next).toBeDefined()
  })

  it('rechaza una confirmación que no coincide', () => {
    // El error de dedo clásico: si no se pide confirmar, una contraseña
    // mal escrita se guarda y la persona queda fuera de su cuenta.
    expect(passwordChangeProblems({ ...valid, confirm: 'MiNuevaClave8' }).confirm).toBeDefined()
  })

  it('con todo vacío marca la actual, la nueva y no confunde "igual" con "falta"', () => {
    // Borde: formulario recién abierto y enviado. Dos vacíos son "iguales",
    // pero el mensaje útil es "escribe tu contraseña actual", no "es igual".
    const problems = passwordChangeProblems({ current: '', next: '', confirm: '' })
    expect(problems.current).toBe('Escribe tu contraseña actual.')
    expect(problems.next).toContain('al menos')
    expect(problems.confirm).toBeUndefined()
  })
})
