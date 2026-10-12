// Mensajes para las reglas de fecha y hora de una cita y para el aviso de traslape.
//
// Función pura (CLAUDE.md §4): entra el error tal como lo lanza Supabase, sale un texto en
// español para la persona. Sin red ni componentes, así se prueba sin base de datos.
//
// Las reglas viven en la base (migración `appointment_schedule_rules`): `create_appointment()` y
// `reschedule_appointment()` rechazan con `check_violation` y un `hint` distinto por causa. El
// formulario también las revisa antes de guardar, pero la base manda: si alguien llama a la API
// directo, o si el reloj del navegador no coincide con el de la base, el rechazo llega aquí.
//
// El traslape NO es un error (el mismo empleado puede tener dos citas encimadas, D26 punto 1):
// solo se avisa, con `overlapNoticeText`.

/** Causas con las que la base rechaza el horario de una cita (el `hint` del error). */
export type AppointmentRuleHint =
  | 'appointment_in_past'
  | 'end_before_start'
  | 'branch_closed_day'
  | 'outside_branch_hours'

const RULE_MESSAGES: Record<AppointmentRuleHint, string> = {
  appointment_in_past: 'Ese horario ya pasó. Elige una hora que todavía no haya pasado.',
  end_before_start: 'La cita debe terminar después de que empieza.',
  branch_closed_day: 'La sucursal no abre ese día. Elige otra fecha.',
  outside_branch_hours:
    'La cita queda fuera del horario de la sucursal. Elige otro horario.',
}

function isRuleHint(value: unknown): value is AppointmentRuleHint {
  return (
    typeof value === 'string' &&
    Object.prototype.hasOwnProperty.call(RULE_MESSAGES, value)
  )
}

/**
 * La causa con la que la base rechazó el horario, o `null` si el error es de otra cosa
 * (conexión, permisos, un empleado que no atiende ese tipo de cita...).
 */
export function appointmentRuleHint(error: unknown): AppointmentRuleHint | null {
  if (typeof error !== 'object' || error === null) return null
  const hint = (error as { hint?: unknown }).hint
  return isRuleHint(hint) ? hint : null
}

/** El mensaje para mostrar de una regla de horario, o `null` si el error no es de ese tipo. */
export function appointmentRuleMessage(error: unknown): string | null {
  const hint = appointmentRuleHint(error)
  return hint ? RULE_MESSAGES[hint] : null
}

/**
 * Aviso de que un horario se traslapa con otra cita del mismo empleado. `startsAt` y `endsAt`
 * son 'HH:mm' locales de la sucursal (lo que devuelve `computeSlotStatuses` en `conflict`).
 */
export function overlapNoticeText(conflict: {
  startsAt: string
  endsAt: string
}): string {
  return `Este horario se traslapa con otra cita del empleado, de las ${conflict.startsAt} a las ${conflict.endsAt}.`
}
