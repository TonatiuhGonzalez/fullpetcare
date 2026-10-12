import { describe, expect, it } from 'vitest'

import {
  appointmentRuleHint,
  appointmentRuleMessage,
  overlapNoticeText,
} from './appointmentErrors'

describe('appointmentRuleHint', () => {
  // Qué cubre: reconoce cada causa con la que la base rechaza el horario.
  // Qué se rompería: la interfaz mostraría el mismo "no se pudo agendar" genérico para un
  // horario pasado que para un día cerrado, y la persona no sabría qué corregir.
  it('reconoce las cuatro causas de rechazo de horario', () => {
    for (const hint of [
      'appointment_in_past',
      'end_before_start',
      'branch_closed_day',
      'outside_branch_hours',
    ]) {
      expect(appointmentRuleHint({ code: '23514', hint })).toBe(hint)
    }
  })

  // Qué cubre: un error que NO es de horario (permisos, conexión, un hint de otra regla) da null.
  // Qué se rompería: un fallo de permisos se mostraría como "ese horario ya pasó", un mensaje
  // falso que manda a la persona a corregir algo que no estaba mal.
  it('devuelve null para errores que no son de horario', () => {
    expect(
      appointmentRuleHint({ code: '42501', hint: 'employee_has_scheduled_appointments' }),
    ).toBeNull()
    expect(appointmentRuleHint({ message: 'Failed to fetch' })).toBeNull()
    expect(appointmentRuleHint(new Error('boom'))).toBeNull()
  })

  // Qué cubre: bordes de la entrada (nada, texto suelto, hint que no es texto).
  // Qué se rompería: el `catch` de un formulario truena al leer `.hint` de undefined justo
  // cuando ya iba a mostrar un error, y la persona se queda sin ningún mensaje.
  it('no truena con entradas raras', () => {
    expect(appointmentRuleHint(undefined)).toBeNull()
    expect(appointmentRuleHint(null)).toBeNull()
    expect(appointmentRuleHint('appointment_in_past')).toBeNull()
    expect(appointmentRuleHint({ hint: 42 })).toBeNull()
    // "toString" existe en todo objeto: no debe contar como una causa válida.
    expect(appointmentRuleHint({ hint: 'toString' })).toBeNull()
  })
})

describe('appointmentRuleMessage', () => {
  // Qué cubre: cada causa tiene su propio mensaje, en español y sin jerga (§5.4).
  // Qué se rompería: dos causas distintas compartirían texto, o el mensaje saldría vacío.
  it('da un mensaje distinto y legible por causa', () => {
    const messages = [
      'appointment_in_past',
      'end_before_start',
      'branch_closed_day',
      'outside_branch_hours',
    ].map((hint) => appointmentRuleMessage({ hint }))

    expect(messages.every((m) => typeof m === 'string' && m.length > 10)).toBe(true)
    expect(new Set(messages).size).toBe(4)
  })

  // Qué cubre: sin causa conocida devuelve null, para que quien llama use su mensaje genérico.
  // Qué se rompería: se perdería la diferencia entre "horario inválido" y "falló la conexión".
  it('devuelve null cuando el error no es de horario', () => {
    expect(appointmentRuleMessage({ message: 'timeout' })).toBeNull()
  })
})

describe('overlapNoticeText', () => {
  // Qué cubre: el aviso menciona las horas de la cita con la que choca.
  // Qué se rompería: el aviso diría "hay un traslape" sin decir con qué, y quien agenda no
  // podría decidir si le conviene aceptarlo.
  it('incluye el rango de la cita con la que se traslapa', () => {
    const text = overlapNoticeText({ startsAt: '10:00', endsAt: '10:45' })
    expect(text).toContain('10:00')
    expect(text).toContain('10:45')
    expect(text).toMatch(/traslapa/)
  })
})
