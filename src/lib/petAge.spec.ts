// Tests de lib/petAge.ts (fase 27, tarea 27.6): edad ↔ fecha de nacimiento aproximada.
import { describe, expect, it } from 'vitest'

import { ageFromBirthDate, ageProblem, birthDateFromAge, formatAge } from './petAge'

describe('birthDateFromAge', () => {
  // Qué prueba: el caso de la recepción: "tiene 3 años" sin meses.
  // Qué se rompería: la fecha propuesta saldría en otro año y el veterinario le diría al
  // cliente una edad distinta a la que dijo.
  it('resta años completos conservando día y mes', () => {
    expect(birthDateFromAge('2026-10-14', 3, 0)).toBe('2023-10-14')
  })

  // Qué prueba: años y meses juntos, cruzando de año.
  it('resta meses cruzando el año', () => {
    expect(birthDateFromAge('2026-02-10', 1, 4)).toBe('2024-10-10')
  })

  // Qué prueba: el borde del día 31. 31 de marzo menos 1 mes no existe en febrero.
  // Qué se rompería: `new Date` desbordaría a "3 de marzo" y la mascota "nacería" un mes
  // después de lo calculado.
  it('usa el último día del mes cuando el día de hoy no existe en el mes resultante', () => {
    expect(birthDateFromAge('2026-03-31', 0, 1)).toBe('2026-02-28')
    expect(birthDateFromAge('2024-03-31', 0, 1)).toBe('2024-02-29')
  })

  // Qué prueba: 29 de febrero menos 1 año cae en un año sin bisiesto.
  it('maneja el 29 de febrero', () => {
    expect(birthDateFromAge('2024-02-29', 1, 0)).toBe('2023-02-28')
  })

  // Qué prueba: enero resta meses hacia el año anterior sin dar un mes 0.
  it('resta meses desde enero sin producir un mes 0', () => {
    expect(birthDateFromAge('2026-01-15', 0, 1)).toBe('2025-12-15')
    expect(birthDateFromAge('2026-01-15', 0, 12)).toBe('2025-01-15')
  })
})

describe('ageFromBirthDate', () => {
  // Qué prueba: ida y vuelta: la edad que sale de la fecha propuesta es la que se capturó.
  it('regresa la edad capturada al convertir y volver', () => {
    const born = birthDateFromAge('2026-10-14', 3, 2)
    expect(ageFromBirthDate(born, '2026-10-14')).toEqual({ years: 3, months: 2 })
  })

  // Qué prueba: el día del mes cuenta. El mes está cumplido hasta que llega su día.
  // Qué se rompería: una mascota nacida el 20 de septiembre diría "1 mes" el 14 de octubre.
  it('no cuenta un mes que aún no se cumple', () => {
    expect(ageFromBirthDate('2026-09-20', '2026-10-14')).toEqual({ years: 0, months: 0 })
    expect(ageFromBirthDate('2026-09-14', '2026-10-14')).toEqual({ years: 0, months: 1 })
  })

  // Qué prueba: el cumpleaños exacto cuenta como año cumplido.
  it('cuenta el año el mismo día del cumpleaños', () => {
    expect(ageFromBirthDate('2023-10-14', '2026-10-14')).toEqual({ years: 3, months: 0 })
    expect(ageFromBirthDate('2023-10-15', '2026-10-14')).toEqual({ years: 2, months: 11 })
  })

  // Qué prueba: una fecha futura no produce edad negativa: devuelve nulo.
  it('devuelve nulo si la fecha es futura', () => {
    expect(ageFromBirthDate('2026-10-15', '2026-10-14')).toBeNull()
  })
})

describe('formatAge', () => {
  // Qué prueba: singular y plural, y que 0 años o 0 meses no se escriben.
  it('escribe singular, plural y omite ceros', () => {
    expect(formatAge({ years: 3, months: 2 })).toBe('3 años 2 meses')
    expect(formatAge({ years: 1, months: 0 })).toBe('1 año')
    expect(formatAge({ years: 0, months: 8 })).toBe('8 meses')
    expect(formatAge({ years: 0, months: 1 })).toBe('1 mes')
    expect(formatAge({ years: 0, months: 0 })).toBe('Menos de 1 mes')
  })
})

describe('ageProblem', () => {
  // Qué prueba: vacío cuenta como 0, pero años y meses en 0 no sirven.
  it('acepta años sin meses y rechaza edad cero', () => {
    expect(ageProblem(3, '')).toBeNull()
    expect(ageProblem('', 6)).toBeNull()
    expect(ageProblem(0, 0)).not.toBeNull()
  })

  // Qué prueba: bordes de meses (11 sí, 12 no) y de años (tope 50), decimales y negativos.
  it('rechaza meses fuera de 0-11, decimales, negativos y edades absurdas', () => {
    expect(ageProblem(1, 11)).toBeNull()
    expect(ageProblem(1, 12)).not.toBeNull()
    expect(ageProblem(1.5, 0)).not.toBeNull()
    expect(ageProblem(-1, 0)).not.toBeNull()
    expect(ageProblem(50, 0)).toBeNull()
    expect(ageProblem(51, 0)).not.toBeNull()
  })
})
