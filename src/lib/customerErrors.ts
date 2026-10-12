// Mensajes para los errores al guardar un cliente (C1.14).
//
// Función pura (CLAUDE.md §4): entra el error tal como lo lanza Supabase, sale un texto en
// español para la persona. La regla del correo vive en la base (trigger
// `prevent_duplicate_customer_email`): rechaza con `23505` y el `hint` `customer_email_taken`.
// El formulario no puede saberlo antes de guardar (otra persona pudo registrar el correo hace
// un segundo), así que el rechazo llega aquí y se traduce.

export const EMAIL_TAKEN_MESSAGE = 'Este correo ya está registrado.'

const DEFAULT_MESSAGE = 'No se pudo guardar el cliente. Revisa tu conexión.'

function field(error: unknown, key: 'code' | 'hint' | 'message'): string | null {
  if (typeof error !== 'object' || error === null) return null
  const value = (error as Record<string, unknown>)[key]
  return typeof value === 'string' ? value : null
}

/** `true` si la base rechazó el guardado porque otro cliente del negocio ya usa ese correo. */
export function isEmailTakenError(error: unknown): boolean {
  return field(error, 'code') === '23505' && field(error, 'hint') === 'customer_email_taken'
}

/**
 * El texto para mostrar al fallar el alta o la edición de un cliente (§5.4: español, sin
 * jerga). Un `check_violation` de `create_customer_with_pet` ya trae su mensaje en español
 * ("El nombre de la mascota es obligatorio."), así que se muestra tal cual.
 */
export function customerSaveErrorMessage(error: unknown): string {
  if (isEmailTakenError(error)) return EMAIL_TAKEN_MESSAGE
  if (field(error, 'code') === '23514') {
    const message = field(error, 'message')
    if (message) return message
  }
  return DEFAULT_MESSAGE
}
