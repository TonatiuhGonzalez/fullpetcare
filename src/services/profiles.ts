import { supabase } from './supabase'

export interface MyProfile {
  fullName: string
  avatarPath: string | null
}

/** El profile (nombre, foto) de un usuario. null si no existe (no debería pasar: el trigger de la migración lo crea al registrarse). */
export async function getProfile(userId: string): Promise<MyProfile | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('full_name, avatar_path')
    .eq('id', userId)
    .maybeSingle()

  if (error) throw error
  if (!data) return null

  return { fullName: data.full_name, avatarPath: data.avatar_path }
}
