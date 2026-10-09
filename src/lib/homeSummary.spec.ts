// Pruebas del resumen del día de la pantalla Inicio. Si estas cuentas fallan, el
// dueño ve en Inicio cifras que no coinciden con la Agenda ni con Cobro y deja de
// confiar en la pantalla.
import { describe, expect, it } from 'vitest'

import {
  awaitingPayment,
  estimatedPendingCents,
  summarizeDay,
  upcomingAppointments,
  type SummaryAppointment,
} from './homeSummary'

const appt = (
  id: string,
  status: SummaryAppointment['status'],
  starts_at = '2026-10-08T15:00:00Z',
): SummaryAppointment => ({ id, status, starts_at })

describe('summarizeDay', () => {
  // Qué prueba: un día sin citas. Debe dar ceros, no error ni undefined: es lo que ve
  // un negocio el lunes por la mañana.
  it('con un día vacío da todo en cero', () => {
    expect(summarizeDay([], new Set())).toEqual({
      total: 0,
      scheduled: 0,
      inProgress: 0,
      awaitingPayment: 0,
      paid: 0,
      cancelled: 0,
    })
  })

  // Qué prueba: que cada cita cae en UN solo grupo y que las canceladas y las "no se
  // presentó" no inflan el total del día. Si contaran, "citas de hoy" mentiría.
  it('reparte cada cita en un solo grupo y excluye canceladas del total', () => {
    const summary = summarizeDay(
      [
        appt('a', 'scheduled'),
        appt('b', 'in_progress'),
        appt('c', 'completed'),
        appt('d', 'completed'),
        appt('e', 'cancelled'),
        appt('f', 'no_show'),
      ],
      new Set(['d']),
    )
    expect(summary).toEqual({
      total: 4,
      scheduled: 1,
      inProgress: 1,
      awaitingPayment: 1,
      paid: 1,
      cancelled: 2,
    })
  })

  // Qué prueba: que "atendida" sin venta es "por cobrar" y con venta es "cobrada". Es
  // la distinción que más importa en recepción (dinero que se quedó sin cobrar).
  it('distingue una cita atendida cobrada de una por cobrar', () => {
    const s = summarizeDay([appt('x', 'completed')], new Set())
    expect(s.awaitingPayment).toBe(1)
    expect(s.paid).toBe(0)
    const t = summarizeDay([appt('x', 'completed')], new Set(['x']))
    expect(t.awaitingPayment).toBe(0)
    expect(t.paid).toBe(1)
  })
})

describe('upcomingAppointments', () => {
  // Qué prueba: orden por hora y que solo entran las que aún faltan (agendadas o en
  // curso). Una completada o cancelada en la lista de "próximas" confundiría.
  it('ordena por hora y deja fuera atendidas y canceladas', () => {
    const list = upcomingAppointments(
      [
        appt('tarde', 'scheduled', '2026-10-08T20:00:00Z'),
        appt('hecha', 'completed', '2026-10-08T14:00:00Z'),
        appt('curso', 'in_progress', '2026-10-08T15:00:00Z'),
        appt('baja', 'cancelled', '2026-10-08T16:00:00Z'),
      ],
      10,
    )
    expect(list.map((a) => a.id)).toEqual(['curso', 'tarde'])
  })

  // Qué prueba: el límite. Un día con 40 citas no debe llenar la pantalla, y debe
  // conservar las PRIMERAS por hora, no las primeras que llegaron de la base.
  it('respeta el límite quedándose con las más próximas', () => {
    const list = upcomingAppointments(
      [
        appt('c', 'scheduled', '2026-10-08T18:00:00Z'),
        appt('a', 'scheduled', '2026-10-08T16:00:00Z'),
        appt('b', 'scheduled', '2026-10-08T17:00:00Z'),
      ],
      2,
    )
    expect(list.map((a) => a.id)).toEqual(['a', 'b'])
  })

  // Qué prueba: que no modifica la lista original (que es el estado del store). Un
  // sort in situ reordenaría la agenda de quien comparte esos datos.
  it('no reordena la lista que recibe', () => {
    const original = [
      appt('b', 'scheduled', '2026-10-08T17:00:00Z'),
      appt('a', 'scheduled', '2026-10-08T16:00:00Z'),
    ]
    upcomingAppointments(original, 5)
    expect(original.map((a) => a.id)).toEqual(['b', 'a'])
  })
})

describe('awaitingPayment', () => {
  // Qué prueba: solo las atendidas sin venta; las cobradas ya no se deben cobrar y
  // las agendadas aún no se atienden.
  it('devuelve solo las atendidas que no se han cobrado', () => {
    const list = awaitingPayment(
      [
        appt('pend', 'completed', '2026-10-08T15:00:00Z'),
        appt('pagada', 'completed'),
        appt('nueva', 'scheduled'),
      ],
      new Set(['pagada']),
    )
    expect(list.map((a) => a.id)).toEqual(['pend'])
  })
})

describe('estimatedPendingCents', () => {
  // Qué prueba: la suma precio × cantidad en centavos enteros, solo de las citas
  // pendientes. Si sumara servicios de otras citas, el "por cobrar" sería mayor al real.
  it('suma precio por cantidad solo de las citas indicadas', () => {
    const total = estimatedPendingCents(
      ['a', 'b'],
      [
        { appointment_id: 'a', unit_price_cents: 25000, quantity: 1 },
        { appointment_id: 'b', unit_price_cents: 9950, quantity: 2 },
        { appointment_id: 'otra', unit_price_cents: 99900, quantity: 1 },
      ],
    )
    expect(total).toBe(25000 + 19900)
  })

  // Qué prueba: bordes: sin citas pendientes o con un servicio de precio 0 (cortesía)
  // el total es 0, no NaN. Un NaN se vería como "$NaN" en pantalla.
  it('da 0 sin citas pendientes o con servicios de precio cero', () => {
    expect(estimatedPendingCents([], [])).toBe(0)
    expect(
      estimatedPendingCents(
        ['a'],
        [{ appointment_id: 'a', unit_price_cents: 0, quantity: 3 }],
      ),
    ).toBe(0)
  })
})
