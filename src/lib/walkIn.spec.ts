// Pruebas de computeEmployeeWaits / waitLabel (tarea #1969, visitas sin
// cita). Es función pura, así que cada caso es "estos datos adentro, esto
// afuera": sin Supabase ni reloj real (la hora "ahora" llega como argumento).
import { describe, expect, it } from 'vitest'

import { computeEmployeeWaits, waitLabel } from './walkIn'

const ANA = 'ana'
const BETO = 'beto'

describe('computeEmployeeWaits', () => {
  it('empleado sin citas: puede empezar ya, sin espera', () => {
    // Caso base. Si esto fallara, recepción vería "espera" en un empleado
    // que en realidad está libre y mandaría al cliente a otro lado o lo
    // haría esperar sin motivo.
    const waits = computeEmployeeWaits({
      employeeIds: [ANA],
      busyRanges: [],
      nowTime: '10:07',
      durationMinutes: 45,
    })

    expect(waits).toEqual([
      { employeeId: ANA, startsAt: '10:07', endsAt: '10:52', waitMinutes: 0 },
    ])
  })

  it('cita en curso: el empleado empieza cuando esa cita termina', () => {
    // Ana está en una cita de 09:30 a 10:30 y son las 10:00: la visita
    // nueva podría empezar a las 10:30 (espera de 30 min). Si se ignorara
    // la cita en curso, se le encimarían dos mascotas a la misma persona.
    const waits = computeEmployeeWaits({
      employeeIds: [ANA],
      busyRanges: [{ employeeId: ANA, startsAt: '09:30', endsAt: '10:30' }],
      nowTime: '10:00',
      durationMinutes: 30,
    })

    expect(waits[0]).toMatchObject({ startsAt: '10:30', endsAt: '11:00', waitMinutes: 30 })
  })

  it('una cita que empieza justo cuando terminaría la visita no estorba', () => {
    // Son las 10:00, la visita dura 30 min (termina 10:30) y Ana tiene una
    // cita desde las 10:30. Terminar y empezar en el mismo instante no es
    // traslape (mismo criterio que availability.ts y create_appointment()).
    // Si aquí se contara como choque, se pedirían esperas de más.
    const waits = computeEmployeeWaits({
      employeeIds: [ANA],
      busyRanges: [{ employeeId: ANA, startsAt: '10:30', endsAt: '11:30' }],
      nowTime: '10:00',
      durationMinutes: 30,
    })

    expect(waits[0]).toMatchObject({ startsAt: '10:00', waitMinutes: 0 })
  })

  it('un hueco más corto que la visita no sirve: se salta a la cita siguiente', () => {
    // Ana tiene 10:20-11:00 y 11:10-12:00. Son las 10:00 y la visita dura
    // 45 min. Antes de 10:20 solo hay 20 min (no cabe); entre 11:00 y
    // 11:10 hay 10 min (tampoco). El primer lugar real es a las 12:00.
    // Si se tomara el primer hueco sin medir su tamaño, la visita se
    // encimaría con la cita de las 10:20.
    const waits = computeEmployeeWaits({
      employeeIds: [ANA],
      busyRanges: [
        { employeeId: ANA, startsAt: '10:20', endsAt: '11:00' },
        { employeeId: ANA, startsAt: '11:10', endsAt: '12:00' },
      ],
      nowTime: '10:00',
      durationMinutes: 45,
    })

    expect(waits[0]).toMatchObject({ startsAt: '12:00', waitMinutes: 120 })
  })

  it('las citas de otro empleado no cuentan', () => {
    // Beto está ocupado toda la mañana, pero Ana no. Si se mezclaran las
    // citas de todos, nadie parecería libre nunca.
    const waits = computeEmployeeWaits({
      employeeIds: [ANA],
      busyRanges: [{ employeeId: BETO, startsAt: '09:00', endsAt: '13:00' }],
      nowTime: '10:00',
      durationMinutes: 30,
    })

    expect(waits[0].waitMinutes).toBe(0)
  })

  it('ordena de menos a más espera y respeta el orden original en empates', () => {
    // Ana espera 30 min; Beto y Carla están libres. Deben salir primero
    // los libres, en el orden en que llegaron (Beto antes que Carla). Sin
    // orden, recepción tendría que buscar a mano a quién ofrecerle la
    // visita.
    const waits = computeEmployeeWaits({
      employeeIds: [ANA, BETO, 'carla'],
      busyRanges: [{ employeeId: ANA, startsAt: '09:30', endsAt: '10:30' }],
      nowTime: '10:00',
      durationMinutes: 30,
    })

    expect(waits.map((w) => w.employeeId)).toEqual([BETO, 'carla', ANA])
  })

  it('quien no alcanza a terminar antes de medianoche queda fuera', () => {
    // Son las 23:30 y la visita dura 60 min: terminaría al día siguiente,
    // y una cita no puede cruzar la medianoche. Sin este límite se
    // intentaría guardar una cita con un fin en otro día calendario.
    const waits = computeEmployeeWaits({
      employeeIds: [ANA],
      busyRanges: [],
      nowTime: '23:30',
      durationMinutes: 60,
    })

    expect(waits).toEqual([])
  })

  it('duración cero o negativa: no hay nada que calcular', () => {
    // Todavía no se eligió ningún servicio. Regresar vacío evita mostrar
    // "libre ahora" para una visita de cero minutos.
    expect(
      computeEmployeeWaits({ employeeIds: [ANA], busyRanges: [], nowTime: '10:00', durationMinutes: 0 }),
    ).toEqual([])
  })
})

describe('waitLabel', () => {
  it('sin espera dice "Libre ahora"', () => {
    expect(waitLabel(0)).toBe('Libre ahora')
  })

  it('menos de una hora se muestra en minutos', () => {
    expect(waitLabel(45)).toBe('Espera ~45 min')
  })

  it('una hora o más se muestra en horas y minutos', () => {
    // 75 min → "1 h 15 min"; 120 → "2 h" (sin "0 min" sobrando).
    expect(waitLabel(75)).toBe('Espera ~1 h 15 min')
    expect(waitLabel(120)).toBe('Espera ~2 h')
  })
})
