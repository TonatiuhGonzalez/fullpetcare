// Imagen de la empresa (fase 26, PLAN.md D29). Único archivo que habla con Supabase para
// esto (CLAUDE.md §4). El archivo vive en el bucket privado `tenant-logos`; la ruta se
// guarda en `tenants.logo_path` con la función `set_tenant_logo()` (solo el dueño).
import { supabase } from './supabase'

const BUCKET = 'tenant-logos'

// El menú muestra la imagen todo el rato, así que la URL firmada dura una hora (la foto de
// una mascota, que se ve un instante, dura un minuto). Se pide de nuevo al cambiar de negocio.
const SIGNED_URL_SECONDS = 60 * 60

/**
 * Sube la imagen al MISMO nombre de archivo del negocio (`upsert`) para no acumular
 * huérfanos al reemplazarla. Devuelve la ruta; todavía no queda guardada en el negocio.
 */
export async function upload(path: string, file: File): Promise<string> {
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, { upsert: true, contentType: file.type })
  if (error) throw error
  return path
}

/** Borra el archivo. Un archivo que ya no existe no es un error. */
export async function removeFile(path: string): Promise<void> {
  const { error } = await supabase.storage.from(BUCKET).remove([path])
  if (error) throw error
}

/** Guarda la ruta en el negocio, o la quita con `null`. Solo el dueño (la base lo revalida). */
export async function setPath(tenantId: string, path: string | null): Promise<void> {
  const { error } = await supabase.rpc('set_tenant_logo', {
    p_tenant_id: tenantId,
    // La función trata el texto vacío como "sin imagen".
    p_logo_path: path ?? '',
  })
  if (error) throw error
}

/** URL firmada para mostrar la imagen, o `null` si el archivo ya no está. */
export async function getUrl(path: string): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, SIGNED_URL_SECONDS)
  if (error) return null
  return data.signedUrl
}
