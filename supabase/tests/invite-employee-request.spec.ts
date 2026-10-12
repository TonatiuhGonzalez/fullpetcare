// Prueba la lógica pura de invite-employee (supabase/functions/invite-employee/
// request.ts). No toca la base ni la red: es validación de cuerpo y reglas de
// "a quién se puede restablecer".
import { describe, expect, it } from 'vitest'

import {
  parseEmployeeRequest,
  resetBlockReason,
  type ResetTarget,
} from '../functions/invite-employee/request'

describe('parseEmployeeRequest', () => {
  it('sin action sigue siendo "invitar" (compatibilidad con el frontend anterior)', () => {
    // Si un cuerpo viejo dejara de entenderse, dar de alta empleados se
    // rompería para cualquier navegador con la versión anterior de la app.
    expect(
      parseEmployeeRequest({ tenantId: 't1', email: ' ANA@Mail.mx ', fullName: ' Ana ' }),
    ).toEqual({ action: 'invite', tenantId: 't1', email: 'ana@mail.mx', fullName: 'Ana' })
  })

  it('invitar sigue exigiendo correo y nombre', () => {
    // Sin esto se crearían usuarios de Auth sin correo útil.
    expect(parseEmployeeRequest({ tenantId: 't1', email: '', fullName: 'Ana' })).toBeNull()
    expect(parseEmployeeRequest({ tenantId: 't1', email: 'a@b.mx', fullName: '  ' })).toBeNull()
  })

  it('reset_password pide tenantId y membershipId', () => {
    // Sin el membershipId la función no sabría a quién restablecer.
    expect(
      parseEmployeeRequest({ action: 'reset_password', tenantId: 't1', membershipId: 'm1' }),
    ).toEqual({ action: 'reset_password', tenantId: 't1', membershipId: 'm1' })
    expect(parseEmployeeRequest({ action: 'reset_password', tenantId: 't1' })).toBeNull()
    expect(parseEmployeeRequest({ action: 'reset_password', membershipId: 'm1' })).toBeNull()
  })

  it('una acción desconocida o un cuerpo que no es objeto se rechaza', () => {
    // Una acción nueva mal escrita no debe caer por omisión en "invitar".
    expect(parseEmployeeRequest({ action: 'delete_all', tenantId: 't1' })).toBeNull()
    expect(parseEmployeeRequest(null)).toBeNull()
    expect(parseEmployeeRequest('hola')).toBeNull()
  })
})

describe('resetBlockReason', () => {
  const base: ResetTarget = { userId: 'u2', role: 'groomer', isActive: true, isDeleted: false }

  it('un empleado activo y distinto de quien llama se puede restablecer', () => {
    expect(resetBlockReason('u1', base)).toBeNull()
  })

  it('uno mismo se bloquea antes que cualquier otra razón', () => {
    // Un dueño que se apunta a sí mismo debe ver "tu propia contraseña", no
    // "es el dueño".
    expect(resetBlockReason('u2', { ...base, role: 'owner' })).toBe('self')
  })

  it('el dueño se bloquea', () => {
    // A los dueños los restablece la plataforma (§7.5).
    expect(resetBlockReason('u1', { ...base, role: 'owner' })).toBe('owner')
  })

  it('una membresía inactiva o eliminada se bloquea', () => {
    expect(resetBlockReason('u1', { ...base, isActive: false })).toBe('inactive')
    expect(resetBlockReason('u1', { ...base, isDeleted: true })).toBe('inactive')
  })
})
