// Todo lo relacionado con "quién soy" (login/logout/sesión actual) pasa
// por aquí. useSessionStore llama a estas funciones — nunca llama a
// supabase.auth directo (CLAUDE.md §4, la regla de capas).
import { supabase } from './supabase'

export interface AuthUser {
  id: string
  email: string
}

/** Inicia sesión con correo y contraseña. Lanza si las credenciales son inválidas. */
export async function signIn(email: string, password: string): Promise<AuthUser> {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) throw error
  if (!data.user?.email) throw new Error('Supabase no devolvió un usuario válido.')
  return { id: data.user.id, email: data.user.email }
}

/** Cierra la sesión actual (borra el token que supabase-js guarda en localStorage). */
export async function signOut(): Promise<void> {
  const { error } = await supabase.auth.signOut()
  if (error) throw error
}

/**
 * Usuario de la sesión ya existente, si la hay — para restaurar la sesión
 * al recargar la página (supabase-js persiste el token entre recargas
 * solo; esto lee ese token, no crea uno nuevo).
 */
export async function getCurrentUser(): Promise<AuthUser | null> {
  const { data, error } = await supabase.auth.getUser()
  if (error || !data.user?.email) return null
  return { id: data.user.id, email: data.user.email }
}

/**
 * Avisa cuando supabase-js pierde la sesión por su cuenta: el refresh
 * token expiró o fue revocado, se cumplió el timebox/inactividad del
 * servidor (supabase/config.toml, [auth.sessions]), o se cerró sesión en
 * OTRA pestaña (supabase-js lo propaga por el evento "storage"). En todos
 * esos casos emite SIGNED_OUT. Devuelve la función para cancelar la
 * suscripción.
 */
export function onSessionLost(callback: () => void): () => void {
  const { data } = supabase.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT') callback()
  })
  return () => data.subscription.unsubscribe()
}

/**
 * La contraseña actual que escribió la persona no es la correcta. Clase
 * propia (no un Error suelto) para que la UI la distinga de "no hay red" o
 * "contraseña débil" y ponga el mensaje en el campo correcto.
 */
export class InvalidCurrentPasswordError extends Error {
  constructor() {
    super('La contraseña actual no es correcta.')
    this.name = 'InvalidCurrentPasswordError'
  }
}

/**
 * Cambia la contraseña de la persona con sesión abierta.
 *
 * Pasos, y por qué cada uno:
 * 1. Verifica la contraseña ACTUAL volviendo a iniciar sesión con ella.
 *    `auth.updateUser` por sí solo NO la pide (basta con tener sesión), así
 *    que sin este paso una sesión olvidada en un equipo compartido bastaría
 *    para quedarse con la cuenta. Iniciar sesión otra vez con el mismo
 *    usuario solo renueva la sesión; no cambia quién es.
 * 2. Cambia la contraseña.
 * 3. Cierra las OTRAS sesiones de esa cuenta (otros navegadores/equipos),
 *    no la actual: si alguien más tenía la contraseña vieja, queda fuera. Si
 *    este paso falla, la contraseña YA cambió: se registra y no se lanza,
 *    para no decirle a la persona que falló algo que sí se hizo.
 */
export async function changePassword(
  email: string,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const { error: verifyError } = await supabase.auth.signInWithPassword({
    email,
    password: currentPassword,
  })
  if (verifyError) throw new InvalidCurrentPasswordError()

  const { error: updateError } = await supabase.auth.updateUser({ password: newPassword })
  if (updateError) throw updateError

  const { error: othersError } = await supabase.auth.signOut({ scope: 'others' })
  if (othersError) {
    console.error('changePassword: no se pudieron cerrar las otras sesiones', othersError)
  }
}
