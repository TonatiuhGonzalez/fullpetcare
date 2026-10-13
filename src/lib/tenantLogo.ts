// Reglas de la imagen de la empresa (fase 26, PLAN.md D29). Funciones puras: la misma regla
// que repite el bucket `tenant-logos` (tipos y tope de tamaño) y `set_tenant_logo()` (forma
// de la ruta), para avisarle a la persona ANTES de subir y no con un error de Storage.

/** Tope del bucket `tenant-logos`: 2 MB. */
export const LOGO_MAX_BYTES = 2 * 1024 * 1024

const EXTENSION_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

/** Valor para el atributo `accept` del selector de archivos. */
export const LOGO_ACCEPT = Object.keys(EXTENSION_BY_MIME).join(',')

/** Extensión que corresponde al tipo del archivo, o `null` si no es una imagen admitida. */
export function logoExtension(mimeType: string): string | null {
  return EXTENSION_BY_MIME[mimeType] ?? null
}

/** Ruta del archivo en el bucket: `{tenant_id}/logo.{ext}` (la carpeta es la seguridad, §7). */
export function logoPath(tenantId: string, extension: string): string {
  return `${tenantId}/logo.${extension}`
}

/** Mensaje para la persona si el archivo no sirve; `null` si se puede subir. */
export function logoFileProblem(file: { type: string; size: number }): string | null {
  if (logoExtension(file.type) === null) return 'Elige una imagen JPG, PNG o WebP.'
  if (file.size > LOGO_MAX_BYTES) return 'La imagen pesa más de 2 MB. Elige una más ligera.'
  return null
}
