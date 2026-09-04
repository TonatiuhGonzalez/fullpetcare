// El mejor material didáctico del proyecto (TASKS.md tarea 3.7): cada
// caso de aquí es un escenario real de agenda, y como computeAvailableSlots
// es una función pura (ver el comentario largo en availability.ts), cada
// uno se prueba con solo "estos datos adentro, esto afuera" — sin
// Supabase, sin Docker, sin base de datos.
import { describe, expect, it } from 'vitest'

import { computeAvailableSlots, hoursForDate, type ExistingAppointment } from './availability'

const EMPLOYEE = 'empleado-1'
const OTHER_EMPLOYEE = 'empleado-2'

describe('computeAvailableSlots', () => {
  it('día vacío: sin citas, ofrece un hueco por cada paso desde que abre hasta que ya no cabe el servicio', () => {
    // Sucursal 09:00-11:00, servicio de 30 min, pasos de 30 min. Caben
    // exactamente 4 huecos: 09:00, 09:30, 10:00, 10:30 — NO 11:00
    // (terminaría a las 11:30, después de cerrar).
    const slots = computeAvailableSlots({
      branchHours: { opensAt: '09:00', closesAt: '11:00' },
      existingAppointments: [],
      employeeId: EMPLOYEE,
      durationMinutes: 30,
      stepMinutes: 30,
    })

    expect(slots).toEqual([
      { startsAt: '09:00', endsAt: '09:30' },
      { startsAt: '09:30', endsAt: '10:00' },
      { startsAt: '10:00', endsAt: '10:30' },
      { startsAt: '10:30', endsAt: '11:00' },
    ])
  })

  it('una cita a media mañana parte el día en dos', () => {
    // Sucursal 09:00-13:00, una cita de 10:00 a 11:00 (de OTRO empleado
    // no cuenta — se agrega una de EMPLOYEE ahí). Servicio de 30 min,
    // pasos de 30. Deben faltar justo los huecos que se traslapan con
    // 10:00-11:00: ni "09:30" (terminaría 10:00, no se traslapa — sí
    // cabe) ni "11:00" (empieza justo cuando termina la ocupada — sí
    // cabe), pero SÍ deben faltar "10:00" y "10:30".
    const busy: ExistingAppointment = {
      employeeId: EMPLOYEE,
      startsAt: '10:00',
      endsAt: '11:00',
    }
    const slots = computeAvailableSlots({
      branchHours: { opensAt: '09:00', closesAt: '13:00' },
      existingAppointments: [busy],
      employeeId: EMPLOYEE,
      durationMinutes: 30,
      stepMinutes: 30,
    })

    const startTimes = slots.map((s) => s.startsAt)
    expect(startTimes).not.toContain('10:00')
    expect(startTimes).not.toContain('10:30')
    expect(startTimes).toContain('09:30') // termina 10:00, justo cuando empieza la ocupada
    expect(startTimes).toContain('11:00') // empieza justo cuando termina la ocupada
  })

  it('una cita que terminaría exactamente cuando empezaría otra SÍ cabe (los extremos no se traslapan)', () => {
    // Caso de borde explícito, aislado del anterior: una sola cita
    // ocupada de 10:00 a 11:00, y se pide justo el hueco de 09:30 a
    // 10:00 — termina exactamente cuando empieza la ocupada. Si el
    // traslape se comparara con <=/>= en vez de </> estrictos, este
    // caso fallaría (se rechazaría un hueco que en realidad sí cabe).
    const slots = computeAvailableSlots({
      branchHours: { opensAt: '09:00', closesAt: '11:00' },
      existingAppointments: [{ employeeId: EMPLOYEE, startsAt: '10:00', endsAt: '11:00' }],
      employeeId: EMPLOYEE,
      durationMinutes: 30,
      stepMinutes: 30,
    })

    expect(slots.map((s) => s.startsAt)).toEqual(['09:00', '09:30'])
  })

  it('un servicio más largo que el hueco restante antes de cerrar no se ofrece', () => {
    // Sucursal cierra a las 11:00; un servicio de 90 minutos que
    // empezara a las 10:00 terminaría a las 11:30 — después de cerrar.
    // No debe aparecer ningún hueco que empiece después de las 09:30
    // (09:30 + 90 min = 11:00, justo a tiempo).
    const slots = computeAvailableSlots({
      branchHours: { opensAt: '09:00', closesAt: '11:00' },
      existingAppointments: [],
      employeeId: EMPLOYEE,
      durationMinutes: 90,
      stepMinutes: 30,
    })

    expect(slots).toEqual([
      { startsAt: '09:00', endsAt: '10:30' },
      { startsAt: '09:30', endsAt: '11:00' },
    ])
  })

  it('un empleado con la agenda llena no tiene ningún hueco libre', () => {
    const slots = computeAvailableSlots({
      branchHours: { opensAt: '09:00', closesAt: '11:00' },
      existingAppointments: [{ employeeId: EMPLOYEE, startsAt: '09:00', endsAt: '11:00' }],
      employeeId: EMPLOYEE,
      durationMinutes: 30,
      stepMinutes: 30,
    })

    expect(slots).toEqual([])
  })

  it('las citas de OTRO empleado no bloquean los huecos del empleado consultado', () => {
    // computeAvailableSlots filtra por employeeId internamente (ver el
    // comentario de la firma) — si no filtrara bien, la agenda llena
    // del empleado 2 dejaría sin huecos también al empleado 1.
    const slots = computeAvailableSlots({
      branchHours: { opensAt: '09:00', closesAt: '10:00' },
      existingAppointments: [
        { employeeId: OTHER_EMPLOYEE, startsAt: '09:00', endsAt: '10:00' },
      ],
      employeeId: EMPLOYEE,
      durationMinutes: 30,
      stepMinutes: 30,
    })

    expect(slots).toEqual([
      { startsAt: '09:00', endsAt: '09:30' },
      { startsAt: '09:30', endsAt: '10:00' },
    ])
  })

  it('un día en que la sucursal no abre no ofrece ningún hueco', () => {
    const slots = computeAvailableSlots({
      branchHours: null,
      existingAppointments: [],
      employeeId: EMPLOYEE,
      durationMinutes: 30,
      stepMinutes: 30,
    })

    expect(slots).toEqual([])
  })

  it('una duración de cero minutos no ofrece ningún hueco', () => {
    // Borde defensivo: la tabla services exige duration_minutes > 0
    // (CLAUDE.md, migración services.sql), así que esto no debería pasar
    // con datos reales — pero la función no debe reventar ni devolver
    // huecos sin sentido si de todos modos llega un 0.
    const slots = computeAvailableSlots({
      branchHours: { opensAt: '09:00', closesAt: '11:00' },
      existingAppointments: [],
      employeeId: EMPLOYEE,
      durationMinutes: 0,
      stepMinutes: 30,
    })

    expect(slots).toEqual([])
  })
})

describe('hoursForDate', () => {
  const openingHours = {
    monday: { opensAt: '09:00', closesAt: '18:00' },
    tuesday: { opensAt: '09:00', closesAt: '18:00' },
    sunday: null,
  }

  it('trae el horario del día de la semana correcto', () => {
    // 2027-03-08 es lunes.
    expect(hoursForDate(openingHours, '2027-03-08')).toEqual({
      opensAt: '09:00',
      closesAt: '18:00',
    })
  })

  it('un día explícitamente null (cerrado) da null, no el horario de otro día', () => {
    // 2027-03-07 es domingo.
    expect(hoursForDate(openingHours, '2027-03-07')).toBeNull()
  })

  it('un día que ni siquiera está en el objeto (sin capturar) también da null', () => {
    // 2027-03-10 es miércoles — no está en openingHours de este test.
    expect(hoursForDate(openingHours, '2027-03-10')).toBeNull()
  })
})
