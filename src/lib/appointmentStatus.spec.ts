import { describe, expect, it } from 'vitest'

import { canTransition } from './appointmentStatus'

describe('canTransition', () => {
  it('scheduled → in_progress: sí (empezar a atender)', () => {
    expect(canTransition('scheduled', 'in_progress')).toBe(true)
  })

  it('completed → scheduled: no (un estado terminal no vuelve atrás)', () => {
    expect(canTransition('completed', 'scheduled')).toBe(false)
  })

  it('cancelar una cita completada no se vale', () => {
    // Si algo salió mal después de completar una cita, se corrige con
    // una cita nueva — no reabriendo ni cancelando la que ya se atendió
    // y probablemente ya se cobró.
    expect(canTransition('completed', 'cancelled')).toBe(false)
  })

  it('scheduled → cancelled: sí (cancelar antes de atender)', () => {
    expect(canTransition('scheduled', 'cancelled')).toBe(true)
  })

  it('scheduled → no_show: sí (el cliente no llegó)', () => {
    expect(canTransition('scheduled', 'no_show')).toBe(true)
  })

  it('in_progress → completed: sí (terminar de atender)', () => {
    expect(canTransition('in_progress', 'completed')).toBe(true)
  })

  it('in_progress → scheduled: no (no se puede "desatender" una cita)', () => {
    expect(canTransition('in_progress', 'scheduled')).toBe(false)
  })

  it('no_show → in_progress: no (un estado terminal no tiene transiciones)', () => {
    expect(canTransition('no_show', 'in_progress')).toBe(false)
  })

  it('cancelled → scheduled: no (cancelada es definitivo)', () => {
    expect(canTransition('cancelled', 'scheduled')).toBe(false)
  })
})
