// El mejor material didáctico del proyecto (TASKS.md tarea 3.7): cada
// caso de aquí es un escenario real de agenda, y como computeAvailableSlots
// es una función pura (ver el comentario largo en availability.ts), cada
// uno se prueba con solo "estos datos adentro, esto afuera" — sin
// Supabase, sin Docker, sin base de datos.
import { describe, expect, it } from 'vitest'

import {
  computeAvailableSlots,
  computeSlotStatuses,
  hoursForDate,
  type ExistingAppointment,
} from './availability'

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

describe('computeSlotStatuses', () => {
  const TODAY = '2027-03-10'
  const base = {
    branchHours: { opensAt: '09:00', closesAt: '11:00' },
    existingAppointments: [] as ExistingAppointment[],
    employeeId: EMPLOYEE,
    durationMinutes: 30,
    stepMinutes: 30,
    date: TODAY,
    now: { date: '2027-03-01', time: '08:00' },
  }
  const statuses = (slots: { startsAt: string; status: string }[]) =>
    slots.map((s) => `${s.startsAt}:${s.status}`)

  it('devuelve toda la rejilla con estado, sin ocultar ningun hueco', () => {
    // Mismo loop que computeAvailableSlots (4 huecos en 09:00-11:00). Si esta
    // funcion ocultara huecos, la pantalla no podria mostrarlos deshabilitados.
    const slots = computeSlotStatuses(base)
    expect(statuses(slots)).toEqual([
      '09:00:free',
      '09:30:free',
      '10:00:free',
      '10:30:free',
    ])
  })

  it('un hueco anterior a la hora actual es pasado', () => {
    // Hoy a las 09:45: 09:00 y 09:30 ya empezaron. Si se ofrecieran como libres
    // se podria agendar una cita en el pasado.
    const slots = computeSlotStatuses({ ...base, now: { date: TODAY, time: '09:45' } })
    expect(statuses(slots)).toEqual(['09:00:past', '09:30:past', '10:00:free', '10:30:free'])
  })

  it('el hueco que empieza justo en la hora actual todavia se puede elegir (sin tolerancia)', () => {
    // Son las 10:00 y el hueco empieza a las 10:00: no es anterior, es libre.
    // El borde importa: con "<=" se perderia el hueco de "ahora mismo".
    const slots = computeSlotStatuses({ ...base, now: { date: TODAY, time: '10:00' } })
    expect(statuses(slots)).toEqual(['09:00:past', '09:30:past', '10:00:free', '10:30:free'])
  })

  it('hoy a media hora: el hueco de la hora en punto ya paso, el de la media no', () => {
    // 09:30 en punto: 09:00 pasado, 09:30 libre. Verifica la comparacion por
    // minutos y no solo por hora.
    const slots = computeSlotStatuses({ ...base, now: { date: TODAY, time: '09:30' } })
    expect(statuses(slots)[0]).toBe('09:00:past')
    expect(statuses(slots)[1]).toBe('09:30:free')
  })

  it('una fecha anterior a hoy marca todos los huecos como pasados', () => {
    // Aunque la hora actual sea las 08:00, un dia anterior ya no existe.
    // Sin comparar la fecha, se podria agendar ayer a las 10:00.
    const slots = computeSlotStatuses({ ...base, now: { date: '2027-03-11', time: '08:00' } })
    expect(slots.every((s) => s.status === 'past')).toBe(true)
    expect(slots).toHaveLength(4)
  })

  it('una fecha posterior a hoy no marca ninguno como pasado aunque la hora actual sea tarde', () => {
    // Hoy son las 23:00; manana a las 09:00 NO es pasado. Si solo se
    // comparara la hora, mañana por la mañana saldria bloqueado.
    const slots = computeSlotStatuses({ ...base, now: { date: '2027-03-09', time: '23:00' } })
    expect(slots.every((s) => s.status === 'free')).toBe(true)
  })

  it('traslape parcial por minutos: un servicio de 45 min sobre rejilla de 30 choca con la cita siguiente', () => {
    // Cita 10:00-10:45. El servicio de 45 min en 09:30 termina 10:15 y se
    // encima 15 minutos. El hueco de 09:00 (termina 09:45) queda libre.
    const slots = computeSlotStatuses({
      ...base,
      branchHours: { opensAt: '09:00', closesAt: '12:00' },
      durationMinutes: 45,
      existingAppointments: [{ employeeId: EMPLOYEE, startsAt: '10:00', endsAt: '10:45' }],
    })
    expect(slots.find((s) => s.startsAt === '09:00')?.status).toBe('free')
    const partial = slots.find((s) => s.startsAt === '09:30')
    expect(partial?.status).toBe('overlap')
    expect(partial?.conflict).toEqual({ startsAt: '10:00', endsAt: '10:45' })
  })

  it('traslape total: los huecos dentro de la cita ocupada traen con cual chocan', () => {
    // La interfaz dice "se traslapa con la cita de 10:00 a 11:00"; sin
    // `conflict` no tendria con que armar ese mensaje.
    const slots = computeSlotStatuses({
      ...base,
      branchHours: { opensAt: '09:00', closesAt: '12:00' },
      existingAppointments: [{ employeeId: EMPLOYEE, startsAt: '10:00', endsAt: '11:00' }],
    })
    expect(statuses(slots)).toEqual([
      '09:00:free',
      '09:30:free',
      '10:00:overlap',
      '10:30:overlap',
      '11:00:free',
      '11:30:free',
    ])
    expect(slots[2].conflict).toEqual({ startsAt: '10:00', endsAt: '11:00' })
  })

  it('con varias citas que chocan, reporta la primera', () => {
    // Un servicio largo puede topar con dos citas; basta mostrar una. Cubre
    // que `conflict` sea determinista (la primera en la lista).
    const slots = computeSlotStatuses({
      ...base,
      branchHours: { opensAt: '09:00', closesAt: '12:00' },
      durationMinutes: 120,
      existingAppointments: [
        { employeeId: EMPLOYEE, startsAt: '09:30', endsAt: '10:00' },
        { employeeId: EMPLOYEE, startsAt: '10:30', endsAt: '11:00' },
      ],
    })
    expect(slots[0].status).toBe('overlap')
    expect(slots[0].conflict).toEqual({ startsAt: '09:30', endsAt: '10:00' })
  })

  it('las citas de otro empleado no cuentan', () => {
    // El groomer 1 esta libre aunque el groomer 2 tenga la mañana llena. Si
    // contaran, un negocio con varios empleados nunca podria agendar a la vez.
    const slots = computeSlotStatuses({
      ...base,
      existingAppointments: [{ employeeId: OTHER_EMPLOYEE, startsAt: '09:00', endsAt: '11:00' }],
    })
    expect(slots.every((s) => s.status === 'free')).toBe(true)
  })

  it('una cita que termina cuando otra empieza no se traslapa', () => {
    // Cita 09:00-10:00: el hueco de 10:00 queda libre, y el de 09:30 se encima.
    // Los extremos que se tocan no son traslape (igual que en computeAvailableSlots).
    const slots = computeSlotStatuses({
      ...base,
      existingAppointments: [{ employeeId: EMPLOYEE, startsAt: '09:00', endsAt: '10:00' }],
    })
    expect(statuses(slots)).toEqual(['09:00:overlap', '09:30:overlap', '10:00:free', '10:30:free'])
  })

  it('una cita que cubre toda la jornada deja todos los huecos en traslape', () => {
    // Dia completamente ocupado: la lista NO queda vacia (distinto de
    // computeAvailableSlots), para poder explicar por que no hay horarios.
    const slots = computeSlotStatuses({
      ...base,
      existingAppointments: [{ employeeId: EMPLOYEE, startsAt: '08:00', endsAt: '12:00' }],
    })
    expect(slots).toHaveLength(4)
    expect(slots.every((s) => s.status === 'overlap')).toBe(true)
  })

  it('si un hueco es pasado y ademas traslapa, gana pasado', () => {
    // Son las 10:00 y hay cita 09:00-10:00: 09:00 es pasado (no se puede
    // elegir), no "traslape"; el mensaje de traslape seria confuso.
    const slots = computeSlotStatuses({
      ...base,
      now: { date: TODAY, time: '10:00' },
      existingAppointments: [{ employeeId: EMPLOYEE, startsAt: '09:00', endsAt: '10:00' }],
    })
    expect(slots[0].status).toBe('past')
    expect(slots[0].conflict).toBeUndefined()
  })

  it('dia cerrado, duracion 0 o paso 0 devuelven lista vacia', () => {
    // Igual que computeAvailableSlots: sin horario no hay rejilla, y con
    // paso 0 el loop seria infinito.
    expect(computeSlotStatuses({ ...base, branchHours: null })).toEqual([])
    expect(computeSlotStatuses({ ...base, durationMinutes: 0 })).toEqual([])
    expect(computeSlotStatuses({ ...base, stepMinutes: 0 })).toEqual([])
  })
})
