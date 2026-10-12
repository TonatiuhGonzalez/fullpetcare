import { describe, expect, it } from 'vitest'

import {
  customerSaveErrorMessage,
  EMAIL_TAKEN_MESSAGE,
  isEmailTakenError,
} from './customerErrors'

describe('isEmailTakenError', () => {
  it('reconoce el rechazo de la base por correo repetido', () => {
    // Si no se reconociera, la persona vería "Revisa tu conexión" cuando el problema es otro
    // y no sabría qué corregir.
    expect(
      isEmailTakenError({ code: '23505', hint: 'customer_email_taken', message: 'x' }),
    ).toBe(true)
  })

  it('no confunde otro 23505 con el del correo', () => {
    // Otras llaves únicas también lanzan 23505; solo el hint dice que es el correo.
    expect(isEmailTakenError({ code: '23505', hint: 'otra_cosa' })).toBe(false)
  })

  it('no confunde un error de red ni un valor que no es objeto', () => {
    expect(isEmailTakenError(new Error('Failed to fetch'))).toBe(false)
    expect(isEmailTakenError(null)).toBe(false)
    expect(isEmailTakenError('23505')).toBe(false)
  })
})

describe('customerSaveErrorMessage', () => {
  it('traduce el correo repetido', () => {
    expect(customerSaveErrorMessage({ code: '23505', hint: 'customer_email_taken' })).toBe(
      EMAIL_TAKEN_MESSAGE,
    )
  })

  it('muestra tal cual el mensaje en español de una validación de la base', () => {
    // La RPC de alta valida mascota obligatoria con mensajes ya escritos para la persona.
    expect(
      customerSaveErrorMessage({
        code: '23514',
        message: 'El nombre de la mascota es obligatorio.',
      }),
    ).toBe('El nombre de la mascota es obligatorio.')
  })

  it('cae en el mensaje de conexión con cualquier otro error', () => {
    expect(customerSaveErrorMessage(new Error('boom'))).toBe(
      'No se pudo guardar el cliente. Revisa tu conexión.',
    )
  })
})
