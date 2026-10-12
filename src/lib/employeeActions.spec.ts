// Tests de lib/employeeActions.ts (C1.18): qué botones de la columna
// "Acciones" aplican a cada fila, y el mensaje que se muestra al fallar.
import { describe, expect, it } from 'vitest'

import {
  employeeActionsFor,
  friendlyEmployeeActionMessage,
  type EmployeeActionTarget,
} from './employeeActions'

function member(
  id: string,
  role: EmployeeActionTarget['role'],
  isActive = true,
): EmployeeActionTarget {
  return { membershipId: `m-${id}`, userId: `u-${id}`, role, isActive }
}

const owner = member('owner', 'owner')
const groomer = member('groomer', 'groomer')
const team = [owner, groomer]

describe('employeeActionsFor', () => {
  it('a un empleado ajeno y activo le aplica todo', () => {
    // Caso normal: si falla, el dueño no puede gestionar a su equipo.
    expect(employeeActionsFor(groomer, team, 'u-owner')).toEqual({
      canEdit: true,
      toggleActive: 'deactivate',
      canDelete: true,
      canResetPassword: true,
    })
  })

  it('uno mismo no puede desactivarse, eliminarse ni restablecerse la contraseña', () => {
    // Si se mostrara, la persona se quedaría sin acceso a media sesión.
    const second = member('owner2', 'owner')
    const actions = employeeActionsFor(owner, [owner, second], 'u-owner')
    expect(actions.canEdit).toBe(true)
    expect(actions.toggleActive).toBeNull()
    expect(actions.canDelete).toBe(false)
    expect(actions.canResetPassword).toBe(false)
  })

  it('al último dueño activo no se le puede quitar el acceso', () => {
    // Visto por otra persona con permiso (p. ej. recepción): el negocio no
    // puede quedar sin dueño activo.
    const actions = employeeActionsFor(owner, team, 'u-groomer')
    expect(actions.toggleActive).toBeNull()
    expect(actions.canDelete).toBe(false)
  })

  it('con otro dueño activo, un dueño sí se puede desactivar y eliminar', () => {
    const second = member('owner2', 'owner')
    const actions = employeeActionsFor(owner, [owner, second, groomer], 'u-owner2')
    expect(actions.toggleActive).toBe('deactivate')
    expect(actions.canDelete).toBe(true)
  })

  it('otro dueño inactivo no cuenta como "otro dueño activo"', () => {
    // Si contara, se podría dejar al negocio sin ningún dueño con acceso.
    const inactiveOwner = member('owner2', 'owner', false)
    const actions = employeeActionsFor(owner, [owner, inactiveOwner], 'u-groomer')
    expect(actions.canDelete).toBe(false)
  })

  it('a un dueño nunca se le restablece la contraseña desde aquí', () => {
    const second = member('owner2', 'owner')
    expect(employeeActionsFor(second, [owner, second], 'u-owner').canResetPassword).toBe(
      false,
    )
  })

  it('un empleado inactivo ofrece "activar", se puede eliminar y no restablecer contraseña', () => {
    // La función del servidor responde 409 al restablecer a un inactivo.
    const inactive = member('vet', 'vet', false)
    const actions = employeeActionsFor(inactive, [owner, inactive], 'u-owner')
    expect(actions.toggleActive).toBe('activate')
    expect(actions.canDelete).toBe(true)
    expect(actions.canResetPassword).toBe(false)
  })

  it('sin usuario en sesión no trata a nadie como "uno mismo"', () => {
    expect(employeeActionsFor(groomer, team, null).canDelete).toBe(true)
  })
})

describe('friendlyEmployeeActionMessage', () => {
  const fallback = 'No se pudo completar la acción.'

  it('muestra tal cual el mensaje de citas programadas', () => {
    // Es lo que explica por qué no se puede desactivar/eliminar.
    const message = 'Tiene 2 citas programadas; reasígnalas o cancélalas primero.'
    expect(
      friendlyEmployeeActionMessage(
        { code: '23514', message, hint: 'employee_has_scheduled_appointments' },
        fallback,
      ),
    ).toBe(message)
  })

  it('muestra los rechazos en español de la RPC (uno mismo, último dueño, permiso)', () => {
    // Si se tragaran, la persona vería "no se pudo" sin saber qué corregir.
    const msg = 'No se puede eliminar al último dueño del negocio.'
    expect(friendlyEmployeeActionMessage({ code: '23514', message: msg }, fallback)).toBe(
      msg,
    )
    const perm = 'No tienes permiso para eliminar empleados.'
    expect(
      friendlyEmployeeActionMessage({ code: '42501', message: perm }, fallback),
    ).toBe(perm)
  })

  it('oculta los errores técnicos en inglés', () => {
    // Jerga de Postgres/RLS nunca debe llegar a la pantalla (§5.4).
    expect(
      friendlyEmployeeActionMessage(
        {
          code: '42501',
          message: 'new row violates row-level security policy for table "memberships"',
        },
        fallback,
      ),
    ).toBe(fallback)
    expect(
      friendlyEmployeeActionMessage(
        { code: '23514', message: 'violates check constraint "x"' },
        fallback,
      ),
    ).toBe(fallback)
  })

  it('usa el mensaje genérico con errores desconocidos, vacíos o sin error', () => {
    expect(
      friendlyEmployeeActionMessage({ code: '500', message: 'boom' }, fallback),
    ).toBe(fallback)
    expect(friendlyEmployeeActionMessage({ message: '' }, fallback)).toBe(fallback)
    expect(friendlyEmployeeActionMessage(null, fallback)).toBe(fallback)
  })
})
