// Reportes de errores y sugerencias del cliente (tarea #1958). Mismo patrón
// que services/pets.ts#uploadPhoto: la captura va al bucket privado y la fila
// guarda solo la ruta. Los miembros del negocio únicamente ENVÍAN: leer los
// reportes es cosa del superadmin (services/platform.ts#listFeedback).
import { supabase } from './supabase'

/**
 * Guarda un reporte. Si trae captura, se sube PRIMERO y la fila se inserta
 * después con su ruta; el id se genera aquí para poder armar la ruta
 * "{tenant_id}/{report_id}.{ext}" antes de insertar. Si el insert falla
 * (p. ej. negocio en solo lectura) el archivo se intenta borrar para no dejar
 * huérfanos — sin política de DELETE para miembros ese borrado puede fallar y
 * no es grave: el bucket es privado y solo lo lee el superadmin.
 */
export async function send(tenantId: string, message: string, screenshot?: File): Promise<void> {
  const id = crypto.randomUUID()
  let screenshotPath: string | null = null

  if (screenshot) {
    const extension = screenshot.name.split('.').pop() ?? 'png'
    screenshotPath = `${tenantId}/${id}.${extension}`
    const { error: uploadError } = await supabase.storage
      .from('feedback-screenshots')
      .upload(screenshotPath, screenshot)
    if (uploadError) throw uploadError
  }

  // Sin .select(): los miembros no tienen política de SELECT, así que pedir la
  // fila de vuelta fallaría aunque el insert haya funcionado.
  const { error } = await supabase.from('feedback_reports').insert({
    id,
    tenant_id: tenantId,
    message: message.trim(),
    screenshot_path: screenshotPath,
  })
  if (error) {
    if (screenshotPath) {
      await supabase.storage
        .from('feedback-screenshots')
        .remove([screenshotPath])
        .catch(() => undefined)
    }
    throw error
  }
}
