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
