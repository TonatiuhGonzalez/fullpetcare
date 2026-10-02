import { describe, expect, it } from 'vitest'

import {
  MAX_CASH_INPUT_CENTS,
  checkCountedCash,
  checkMovement,
  checkOpeningFloat,
  parsePesosInput,
} from './cashRegister'

describe('parsePesosInput', () => {
  it('convierte pesos con signo, comas y decimales a centavos enteros', () => {
    // Un fondo capturado como "$1,250.50" debe guardarse como 125050, sin flotantes.
    expect(parsePesosInput('$1,250.50')).toBe(125050)
    expect(parsePesosInput('350')).toBe(35000)
    expect(parsePesosInput('0.5')).toBe(50)
    expect(parsePesosInput(' 10.05 ')).toBe(1005)
  })

  it('no sufre los errores de redondeo de los flotantes', () => {
    // 19.99 × 100 en JavaScript da 1998.9999999999998: aquí debe ser exacto.
    expect(parsePesosInput('19.99')).toBe(1999)
    expect(parsePesosInput('0.29')).toBe(29)
  })

  it.each(['', 'abc', '12.345', '-5', '1.2.3', '$', '1e3'])('rechaza %j', (text) => {
    // Un monto dudoso no se acepta: un conteo mal capturado descuadra el corte.
    expect(parsePesosInput(text)).toBeNull()
  })
})

describe('validación de los formularios', () => {
  it('el fondo y el conteo aceptan $0', () => {
    // Abrir sin efectivo o cerrar con la caja vacía son casos reales.
    expect(checkOpeningFloat('0')).toEqual({ cents: 0, error: null })
    expect(checkCountedCash('0')).toEqual({ cents: 0, error: null })
  })

  it('dice qué falta o qué está mal, en español', () => {
    expect(checkOpeningFloat('').error).toBe('Escribe el fondo inicial.')
    expect(checkCountedCash('abc').error).toMatch(/efectivo contado no es válido/)
  })

  it('un monto absurdamente grande se rechaza (un cero de más)', () => {
    expect(checkCountedCash(String(MAX_CASH_INPUT_CENTS / 100 + 1)).error).toMatch(
      /demasiado grande/,
    )
    expect(checkCountedCash(String(MAX_CASH_INPUT_CENTS / 100)).error).toBeNull()
  })

  it('un movimiento exige monto mayor a cero y motivo', () => {
    // Sin motivo no se sabe por qué salió el dinero; un monto 0 no mueve nada.
    expect(checkMovement('0', 'Hielo').error).toMatch(/mayor a cero/)
    expect(checkMovement('30', '   ').error).toBe('Escribe el motivo del movimiento.')
    expect(checkMovement('30', 'Hielo')).toEqual({ cents: 3000, error: null })
  })
})
