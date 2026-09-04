import { describe, expect, it } from 'vitest'

import { dayRangeUtc, formatDate, formatTime, fromBranchTime, toBranchTime } from './datetime'

describe('formatTime', () => {
  it('el mismo instante UTC muestra horas distintas en CDMX, Tijuana y Cancún', () => {
    // Este es el caso que justifica todo el archivo (CLAUDE.md §8.3): un
    // solo instante, tres lecturas correctas y DISTINTAS según la
    // sucursal. Si formatTime ignorara la zona y usara la del navegador
    // o el servidor, las tres saldrían iguales.
    const instant = '2026-07-15T20:30:00Z'

    expect(formatTime(instant, 'America/Mexico_City')).toBe('14:30')
    expect(formatTime(instant, 'America/Tijuana')).toBe('13:30') // verano, UTC-7
    // Quintana Roo (Cancún) tiene SU PROPIA zona, UTC-5 todo el año — una
    // hora adelante de CDMX, no la misma. Otro caso real de "México no
    // es una sola zona horaria" (CLAUDE.md §8.3).
    expect(formatTime(instant, 'America/Cancun')).toBe('15:30')
  })
})

describe('fromBranchTime — el caso Tijuana (horario de verano)', () => {
  it('en verano, Tijuana está a UTC-7', () => {
    // 15 de julio: Tijuana sigue el horario de verano de EE. UU. (la
    // excepción del país, CLAUDE.md §8.3).
    const utc = fromBranchTime('2026-07-15', '14:30', 'America/Tijuana')
    expect(utc.toISOString()).toBe('2026-07-15T21:30:00.000Z')
  })

  it('en invierno, Tijuana está a UTC-8 — el mismo 14:30 da un instante UTC distinto', () => {
    // Mismo método, misma hora local, MES distinto — y el resultado en
    // UTC cambia una hora. Si esto se guardara con un offset fijo en vez
    // de un nombre IANA, uno de los dos casos saldría mal.
    const utc = fromBranchTime('2026-01-15', '14:30', 'America/Tijuana')
    expect(utc.toISOString()).toBe('2026-01-15T22:30:00.000Z')
  })

  it('CDMX no cambia entre verano e invierno (México eliminó el horario de verano en 2022)', () => {
    const verano = fromBranchTime('2026-07-15', '14:30', 'America/Mexico_City')
    const invierno = fromBranchTime('2026-01-15', '14:30', 'America/Mexico_City')
    expect(verano.toISOString()).toBe('2026-07-15T20:30:00.000Z')
    expect(invierno.toISOString()).toBe('2026-01-15T20:30:00.000Z')
  })
})

describe('dayRangeUtc', () => {
  it('el rango del día de una sucursal no es el mismo que el de otra', () => {
    // Misma fecha calendario ("15 de julio"), dos sucursales — los
    // rangos UTC deben ser DISTINTOS. Es justo lo que hace falta para
    // que "la agenda de hoy" filtre por el día correcto en cada
    // sucursal, no por el día UTC.
    const cdmx = dayRangeUtc('2026-07-15', 'America/Mexico_City')
    const tijuana = dayRangeUtc('2026-07-15', 'America/Tijuana')

    expect(cdmx.startUtc.toISOString()).not.toBe(tijuana.startUtc.toISOString())
    expect(cdmx.startUtc.toISOString()).toBe('2026-07-15T06:00:00.000Z')
    expect(tijuana.startUtc.toISOString()).toBe('2026-07-15T07:00:00.000Z')
  })

  it('el rango cubre exactamente 24 horas, incluso cruzando de mes', () => {
    // 31 de enero + 1 día = 1 de febrero. Si el cálculo de "el día
    // siguiente" estuviera hecho a mano (sumando texto en vez de dejar
    // que Date/TZDate normalicen el desbordamiento), este caso es donde
    // se rompería.
    const { startUtc, endUtc } = dayRangeUtc('2026-01-31', 'America/Mexico_City')
    const diffHours = (endUtc.getTime() - startUtc.getTime()) / (1000 * 60 * 60)
    expect(diffHours).toBe(24)
    expect(endUtc.toISOString()).toBe('2026-02-01T06:00:00.000Z')
  })
})

describe('formatDate', () => {
  it('formatea la fecha en español, en la zona de la sucursal', () => {
    expect(formatDate('2026-07-15T20:30:00Z', 'America/Mexico_City')).toBe(
      '15 de julio de 2026',
    )
  })

  it('un instante cerca de medianoche puede caer en un DÍA distinto según la sucursal', () => {
    // 01:00 UTC del 16 de julio son las 19:00 del 15 de julio en CDMX
    // (UTC-6) — mismo instante, fecha calendario distinta. Es el mismo
    // fenómeno que dayRangeUtc, visto desde formatDate.
    const instant = '2026-07-16T01:00:00Z'
    expect(formatDate(instant, 'America/Mexico_City')).toBe('15 de julio de 2026')
  })
})

describe('toBranchTime', () => {
  it('acepta tanto un Date como un string ISO con offset', () => {
    const asDate = toBranchTime(new Date('2026-07-15T20:30:00Z'), 'America/Mexico_City')
    const asString = toBranchTime('2026-07-15T20:30:00Z', 'America/Mexico_City')
    expect(asDate.getTime()).toBe(asString.getTime())
  })
})
